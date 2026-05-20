import { redirect } from "next/navigation";

/** Legacy route — global feed lives on Activity. */
export default function CasinoFeedPage() {
  redirect("/casino/history?view=global");
}
