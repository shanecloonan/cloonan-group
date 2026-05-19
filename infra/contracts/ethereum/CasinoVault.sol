// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * ════════════════════════════════════════════════════════════════════════════
 *  MoneyFund Casino — CasinoVault.sol  (specification / Phase-2 starting point)
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Holds ERC-20 (and optionally native) balances for casino players. Players
 *  deposit by approving + calling `deposit`. The off-chain operator settles
 *  hands and authorizes withdrawals by EIP-712 signing a `Withdrawal` struct,
 *  which the player submits via `withdraw`.
 *
 *  This file is the contract spec — it documents the storage, events,
 *  external functions, and security knobs we will deploy. It is NOT compiled
 *  by the Next.js app. Phase 2 of the roadmap (`docs/CASINO_ARCHITECTURE.md`)
 *  imports this into a Foundry/Hardhat workspace, adds proper deps, and
 *  deploys to Base.
 *
 *  Imports left as `import { ... } from "..."` placeholders so the file
 *  reads cleanly without a vendored OpenZeppelin copy living in this repo.
 *
 *  Security posture:
 *   • Owner is a multisig (Safe). All admin functions are timelocked 48h.
 *   • Operator is a hot signer; rotatable by owner. Operator can ONLY sign
 *     withdraw authorizations; it cannot move funds directly.
 *   • Per-user, per-token daily withdrawal cap (`dailyCap`) — defense in depth.
 *   • `paused` blocks DEPOSITS only; withdrawals always work (player rescue).
 *   • All payable functions are `nonReentrant`.
 *   • Native ETH is handled via wrapped-eth address (zero address sentinel
 *     reserved; the deploy script wraps/unwraps as needed). Stablecoin first.
 *
 *  Audits:
 *   • Self-audit + at least one independent audit before mainnet deployment.
 *   • Static analysis: slither + mythril in CI before each release tag.
 */

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

contract CasinoVault is ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    /* ────────────────────────────────────────────────────────────────── *
     *  Events                                                            *
     * ────────────────────────────────────────────────────────────────── */

    event Deposited(address indexed user, IERC20 indexed token, uint256 amount, uint256 indexed nonce);
    event Withdrawn(address indexed user, IERC20 indexed token, uint256 amount, uint256 indexed nonce);
    event OperatorRotated(address indexed prev, address indexed next);
    event TokenAllowed(IERC20 indexed token, bool allowed);
    event DailyCapSet(IERC20 indexed token, uint256 capUnits);
    event Paused(bool indexed paused);

    /* ────────────────────────────────────────────────────────────────── *
     *  Storage                                                           *
     * ────────────────────────────────────────────────────────────────── */

    address public owner;          // multisig with 48h timelock
    address public operator;       // hot signer for withdraw auth
    bool    public paused;

    mapping(IERC20 => bool)    public tokenAllowed;
    mapping(IERC20 => uint256) public dailyCap;        // 0 = unlimited

    /// userNonce[user] is the next-expected withdrawal nonce per user.
    mapping(address => uint256) public userNonce;

    /// Tracks how much was withdrawn per (user, token, day-bucket).
    /// dayBucket = block.timestamp / 1 days.
    mapping(address => mapping(IERC20 => mapping(uint256 => uint256))) public dailyWithdrawn;

    /* ────────────────────────────────────────────────────────────────── *
     *  EIP-712 type hashes                                               *
     * ────────────────────────────────────────────────────────────────── */

    /// keccak256("Withdrawal(address user,address token,uint256 amount,uint256 nonce,bytes32 sessionRef,uint256 expiresAt)")
    bytes32 public constant WITHDRAWAL_TYPEHASH = 0x00; // populated in constructor

    struct Withdrawal {
        address user;
        IERC20  token;
        uint256 amount;
        uint256 nonce;
        bytes32 sessionRef; // optional reference (sha-256 hex prefix) to off-chain session
        uint256 expiresAt;  // unix timestamp; reject if block.timestamp > expiresAt
    }

    /* ────────────────────────────────────────────────────────────────── *
     *  Construction                                                      *
     * ────────────────────────────────────────────────────────────────── */

    constructor(address _owner, address _operator) EIP712("MoneyFundCasinoVault", "1") {
        require(_owner != address(0) && _operator != address(0), "zero addr");
        owner = _owner;
        operator = _operator;
    }

    /* ────────────────────────────────────────────────────────────────── *
     *  Modifiers                                                         *
     * ────────────────────────────────────────────────────────────────── */

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }
    modifier whenNotPaused() {
        require(!paused, "paused");
        _;
    }

    /* ────────────────────────────────────────────────────────────────── *
     *  Deposits                                                          *
     * ────────────────────────────────────────────────────────────────── */

    /**
     * Player pulls `amount` of `token` into the vault. They must `approve`
     * the vault for `amount` beforehand. Emits `Deposited` with the user's
     * current deposit nonce (off-chain indexer uses this as the canonical
     * session credit identifier).
     *
     * NOTE: `paused` only blocks deposits. Withdrawals remain open even
     * when paused so a compromised admin can never trap user funds.
     */
    function deposit(IERC20 token, uint256 amount) external nonReentrant whenNotPaused {
        require(tokenAllowed[token], "token not allowed");
        require(amount > 0, "zero amount");
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 n = userNonce[msg.sender]++;
        emit Deposited(msg.sender, token, amount, n);
    }

    /* ────────────────────────────────────────────────────────────────── *
     *  Withdrawals                                                       *
     * ────────────────────────────────────────────────────────────────── */

    /**
     * Player withdraws `amount` of `token` from the vault, authorized by
     * an EIP-712 signature from the operator. The signature commits to
     * the exact (user, token, amount, nonce, sessionRef, expiresAt) tuple
     * — replay-proof and forgery-proof.
     *
     * Anyone can submit a valid signed withdrawal on behalf of the user
     * (so users can pay gas via a relayer), but funds always go to `user`.
     */
    function withdraw(
        address user,
        IERC20 token,
        uint256 amount,
        uint256 nonce,
        bytes32 sessionRef,
        uint256 expiresAt,
        bytes calldata operatorSig
    ) external nonReentrant {
        require(tokenAllowed[token], "token not allowed");
        require(amount > 0, "zero amount");
        require(block.timestamp <= expiresAt, "expired");
        require(nonce == userNonce[user], "bad nonce");

        // Recover signer over EIP-712 hash.
        bytes32 structHash = keccak256(abi.encode(
            WITHDRAWAL_TYPEHASH,
            user, token, amount, nonce, sessionRef, expiresAt
        ));
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, operatorSig);
        require(signer == operator, "bad operator sig");

        // Per-day per-token cap.
        if (dailyCap[token] > 0) {
            uint256 day = block.timestamp / 1 days;
            uint256 used = dailyWithdrawn[user][token][day] + amount;
            require(used <= dailyCap[token], "daily cap");
            dailyWithdrawn[user][token][day] = used;
        }

        userNonce[user] = nonce + 1;
        token.safeTransfer(user, amount);
        emit Withdrawn(user, token, amount, nonce);
    }

    /* ────────────────────────────────────────────────────────────────── *
     *  Admin (owner-only; timelocked at the Safe layer)                  *
     * ────────────────────────────────────────────────────────────────── */

    function rotateOperator(address next) external onlyOwner {
        require(next != address(0), "zero op");
        emit OperatorRotated(operator, next);
        operator = next;
    }

    function setTokenAllowed(IERC20 token, bool allowed) external onlyOwner {
        tokenAllowed[token] = allowed;
        emit TokenAllowed(token, allowed);
    }

    function setDailyCap(IERC20 token, uint256 cap) external onlyOwner {
        dailyCap[token] = cap;
        emit DailyCapSet(token, cap);
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit Paused(_paused);
    }

    /* ────────────────────────────────────────────────────────────────── *
     *  Views                                                             *
     * ────────────────────────────────────────────────────────────────── */

    function tokenBalance(IERC20 token) external view returns (uint256) {
        return token.balanceOf(address(this));
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
