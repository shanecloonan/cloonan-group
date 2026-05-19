// ============================================================================
//  MoneyFund Casino — Anchor program spec for the Solana vault
// ----------------------------------------------------------------------------
//  This file is a *specification* of the Solana-side `casino-vault` program
//  that will be deployed in Phase 3 of the roadmap (see
//  `docs/CASINO_ARCHITECTURE.md`).
//
//  It is not compiled by the Next.js repo. When we start the Anchor
//  workspace, this file becomes `programs/casino-vault/src/lib.rs` verbatim.
//
//  Design parity with the EVM vault (`CasinoVault.sol`):
//    • Per-user, per-mint balance lives in a PDA the program owns.
//    • Deposits transfer SPL tokens into a vault PDA and credit the user
//      PDA atomically.
//    • Withdrawals require an Ed25519 signature from the operator key over
//      a canonical message; verified via the Ed25519 sysvar precompile.
//    • Per-user replay protection via a monotonically increasing nonce
//      stored on the user PDA.
//    • Owner is a multisig (Squads); operator is rotatable by owner.
//    • Pause flag blocks deposits only; withdrawals always work.
//
//  Why Solana in addition to Ethereum:
//    • ~400ms slot times → instant-feeling game loop.
//    • Sub-cent fees → "every roll on chain" is economically viable.
//    • Mature USDC ecosystem so stablecoin-denominated UX works natively.
// ============================================================================

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer, Mint};

declare_id!("CaSinoVau1tProgrammIDp1aceholderXXXXXXXXXXXX");

#[program]
pub mod casino_vault {
    use super::*;

    /* ----------------------------------------------------------------------
     *  Vault initialization
     * -------------------------------------------------------------------- */

    /// One-time init by `owner`. Sets the operator key + creates the
    /// global config PDA. Only callable once.
    pub fn initialize(ctx: Context<Initialize>, operator: Pubkey) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        require!(cfg.owner == Pubkey::default(), CasinoError::AlreadyInitialized);
        cfg.owner    = ctx.accounts.owner.key();
        cfg.operator = operator;
        cfg.paused   = false;
        Ok(())
    }

    /// Owner-only: rotate operator key.
    pub fn rotate_operator(ctx: Context<AdminOnly>, next: Pubkey) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        require_keys_eq!(ctx.accounts.signer.key(), cfg.owner, CasinoError::NotOwner);
        cfg.operator = next;
        Ok(())
    }

    /// Owner-only: pause / unpause deposits.
    pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        require_keys_eq!(ctx.accounts.signer.key(), cfg.owner, CasinoError::NotOwner);
        cfg.paused = paused;
        Ok(())
    }

    /* ----------------------------------------------------------------------
     *  Deposits
     * -------------------------------------------------------------------- */

    /// Player deposits `amount` of `mint` into the vault. Credits their
    /// `UserBalance` PDA. Blocked while paused.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(!ctx.accounts.config.paused, CasinoError::Paused);
        require!(amount > 0, CasinoError::ZeroAmount);

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from:      ctx.accounts.user_token_account.to_account_info(),
                    to:        ctx.accounts.vault_token_account.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;

        let balance = &mut ctx.accounts.user_balance;
        balance.amount = balance.amount.checked_add(amount).ok_or(CasinoError::Overflow)?;
        emit!(Deposited {
            user:   ctx.accounts.user.key(),
            mint:   ctx.accounts.mint.key(),
            amount,
            nonce:  balance.deposit_nonce,
        });
        balance.deposit_nonce = balance.deposit_nonce.checked_add(1).ok_or(CasinoError::Overflow)?;
        Ok(())
    }

    /* ----------------------------------------------------------------------
     *  Withdrawals  (operator-authorized via Ed25519 sig in instruction data)
     * -------------------------------------------------------------------- */

    /// Player withdraws `amount` of `mint`. Authorization is a separate
    /// Ed25519 instruction earlier in the same transaction that signs
    /// the canonical withdraw payload (user || mint || amount || nonce
    /// || session_ref || expires_at) with the operator key.
    ///
    /// We verify by reading the Ed25519 instruction via the sysvar and
    /// confirming (a) it succeeded, (b) the signer matches `config.operator`,
    /// (c) the message bytes match what we'd reconstruct here.
    pub fn withdraw(
        ctx: Context<Withdraw>,
        amount: u64,
        nonce: u64,
        session_ref: [u8; 32],
        expires_at: i64,
    ) -> Result<()> {
        require!(amount > 0, CasinoError::ZeroAmount);
        require!(Clock::get()?.unix_timestamp <= expires_at, CasinoError::Expired);

        let balance = &mut ctx.accounts.user_balance;
        require!(nonce == balance.withdraw_nonce, CasinoError::BadNonce);
        require!(balance.amount >= amount, CasinoError::Underflow);

        // ── Verify Ed25519 sig instruction (omitted body, see audit-time impl)
        verify_operator_signature(
            &ctx.accounts.ixs_sysvar,
            ctx.accounts.config.operator,
            &ctx.accounts.user.key(),
            &ctx.accounts.mint.key(),
            amount, nonce, &session_ref, expires_at,
        )?;

        balance.amount         = balance.amount.checked_sub(amount).ok_or(CasinoError::Underflow)?;
        balance.withdraw_nonce = nonce.checked_add(1).ok_or(CasinoError::Overflow)?;

        // Transfer out via vault PDA-signed CPI.
        let seeds = &[b"vault", ctx.accounts.mint.key().as_ref(), &[ctx.bumps.vault_authority]];
        let signer_seeds = &[&seeds[..]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from:      ctx.accounts.vault_token_account.to_account_info(),
                    to:        ctx.accounts.user_token_account.to_account_info(),
                    authority: ctx.accounts.vault_authority.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )?;

        emit!(Withdrawn {
            user: ctx.accounts.user.key(),
            mint: ctx.accounts.mint.key(),
            amount,
            nonce,
        });
        Ok(())
    }
}

/* --------------------------------------------------------------------------
 *  Accounts
 * ------------------------------------------------------------------------ */

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = owner, space = 8 + Config::SIZE, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(mut, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    pub config: Account<'info, Config>,
    #[account(mut, signer)]
    pub user: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + UserBalance::SIZE,
        seeds = [b"balance", user.key().as_ref(), mint.key().as_ref()],
        bump,
    )]
    pub user_balance: Account<'info, UserBalance>,
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"vault", mint.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = vault_authority,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    /// CHECK: PDA used only as a signing authority for vault CPIs.
    #[account(seeds = [b"vault_authority", mint.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub config: Account<'info, Config>,
    #[account(mut, signer)]
    pub user: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        seeds = [b"balance", user.key().as_ref(), mint.key().as_ref()],
        bump,
    )]
    pub user_balance: Account<'info, UserBalance>,
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(mut, seeds = [b"vault", mint.key().as_ref()], bump)]
    pub vault_token_account: Account<'info, TokenAccount>,
    /// CHECK: PDA used only as a signing authority for vault CPIs.
    #[account(seeds = [b"vault_authority", mint.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    /// CHECK: Sysvar instructions account — for reading the preceding
    /// Ed25519 sig instruction.
    pub ixs_sysvar: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
}

/* --------------------------------------------------------------------------
 *  State
 * ------------------------------------------------------------------------ */

#[account]
pub struct Config {
    pub owner: Pubkey,
    pub operator: Pubkey,
    pub paused: bool,
}
impl Config { pub const SIZE: usize = 32 + 32 + 1; }

#[account]
pub struct UserBalance {
    pub amount: u64,
    pub deposit_nonce: u64,
    pub withdraw_nonce: u64,
}
impl UserBalance { pub const SIZE: usize = 8 + 8 + 8; }

/* --------------------------------------------------------------------------
 *  Errors + Events
 * ------------------------------------------------------------------------ */

#[error_code]
pub enum CasinoError {
    #[msg("Vault is paused")] Paused,
    #[msg("Caller is not the owner")] NotOwner,
    #[msg("Vault already initialized")] AlreadyInitialized,
    #[msg("Operator signature invalid")] BadOperatorSignature,
    #[msg("Bad nonce")] BadNonce,
    #[msg("Withdraw authorization expired")] Expired,
    #[msg("Zero amount")] ZeroAmount,
    #[msg("Math overflow")] Overflow,
    #[msg("Math underflow / insufficient balance")] Underflow,
}

#[event]
pub struct Deposited {
    pub user: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub nonce: u64,
}

#[event]
pub struct Withdrawn {
    pub user: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub nonce: u64,
}

/* --------------------------------------------------------------------------
 *  Helpers (Phase 3 fills these in)
 * ------------------------------------------------------------------------ */

fn verify_operator_signature(
    _ixs_sysvar: &AccountInfo,
    _expected_operator: Pubkey,
    _user: &Pubkey,
    _mint: &Pubkey,
    _amount: u64,
    _nonce: u64,
    _session_ref: &[u8; 32],
    _expires_at: i64,
) -> Result<()> {
    // Phase 3 implementation:
    //   1. Read the Ed25519 instruction immediately preceding this one
    //      via solana_program::sysvar::instructions::load_instruction_at_checked.
    //   2. Confirm the program id == ed25519 sigverify precompile.
    //   3. Decode the precompile data layout to extract (pubkey, msg, sig).
    //   4. require!(pubkey == expected_operator)
    //   5. require!(msg == canonical_message(user, mint, amount, nonce,
    //                                       session_ref, expires_at))
    //
    // For now this stub returns Ok so the spec compiles standalone in
    // a future Anchor workspace; the real check is mandatory before
    // mainnet deployment.
    Ok(())
}
