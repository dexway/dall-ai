import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireWorkspace, canManage } from "@/lib/workspace";
import { publicAssetUrl } from "@/lib/supabase/server";
import { formatNaira, nairaToKobo, QuoteError } from "@/lib/money";

export const metadata = { title: "Catalogue" };
const KINDS = [["product", "Product"], ["service", "Service"], ["booking", "Booking / appointment"], ["class", "Class / training"], ["digital", "Digital product"], ["package", "Package / bundle"]];

async function addItem(formData: FormData) {
  "use server";
  const ctx = await requireWorkspace();
  if (!canManage(ctx)) redirect("/dashboard/catalogue?error=role");
  let price: number, intro: number | null = null;
  try {
    price = nairaToKobo(String(formData.get("price")));
    const introRaw = String(formData.get("intro_price") ?? "").trim();
    if (introRaw) intro = nairaToKobo(introRaw);
  } catch (e) { redirect(`/dashboard/catalogue?error=${e instanceof QuoteError ? "price" : "save"}`); }
  if (intro !== null && intro >= price) redirect("/dashboard/catalogue?error=intro");
  const stockRaw = String(formData.get("stock") ?? "").trim();
  let image_path: string | null = null;
  const img = formData.get("image");
  if (img instanceof File && img.size) {
    if (img.size > 4 * 1024 * 1024 || !/^image\/(png|jpeg|webp)$/.test(img.type)) redirect("/dashboard/catalogue?error=image");
    image_path = `${ctx.workspace.id}/catalogue/${crypto.randomUUID()}.${img.type.split("/")[1]}`;
    const up = await ctx.db.storage.from("brand-assets").upload(image_path, img, { contentType: img.type });
    if (up.error) redirect("/dashboard/catalogue?error=image");
  }
  const { error } = await ctx.db.from("catalogue_items").insert({
    workspace_id: ctx.workspace.id,
    kind: String(formData.get("kind") ?? "product"),
    name: String(formData.get("name") ?? "").trim().slice(0, 120),
    description: String(formData.get("description") ?? "").trim().slice(0, 1000),
    price_kobo: price!, intro_price_kobo: intro,
    stock: stockRaw === "" ? null : Math.max(0, parseInt(stockRaw, 10) || 0),
    terms: String(formData.get("terms") ?? "").trim().slice(0, 500) || null,
    image_path,
  });
  if (error) redirect("/dashboard/catalogue?error=save");
  revalidatePath("/dashboard/catalogue");
  redirect("/dashboard/catalogue?saved=1");
}

async function toggle(formData: FormData) {
  "use server";
  const ctx = await requireWorkspace();
  if (!canManage(ctx)) redirect("/dashboard/catalogue?error=role");
  await ctx.db.from("catalogue_items").update({ active: formData.get("active") === "true" }).eq("id", String(formData.get("id"))).eq("workspace_id", ctx.workspace.id);
  revalidatePath("/dashboard/catalogue");
}

async function editItem(formData: FormData) {
  "use server";
  const ctx = await requireWorkspace();
  if (!canManage(ctx)) redirect("/dashboard/catalogue?error=role");
  let price: number, intro: number | null = null;
  try {
    price = nairaToKobo(String(formData.get("price")));
    const introRaw = String(formData.get("intro_price") ?? "").trim();
    if (introRaw) intro = nairaToKobo(introRaw);
  } catch { redirect("/dashboard/catalogue?error=price"); }
  if (intro !== null && intro >= price!) redirect("/dashboard/catalogue?error=intro");
  const stockRaw = String(formData.get("stock") ?? "").trim();
  const { error } = await ctx.db.from("catalogue_items").update({
    price_kobo: price!, intro_price_kobo: intro, stock: stockRaw === "" ? null : Math.max(0, parseInt(stockRaw, 10) || 0),
  }).eq("id", String(formData.get("id"))).eq("workspace_id", ctx.workspace.id);
  if (error) redirect("/dashboard/catalogue?error=save");
  revalidatePath("/dashboard/catalogue");
  redirect("/dashboard/catalogue?saved=edit");
}

export default async function Catalogue({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireWorkspace();
  const sp = await searchParams;
  const { data: items } = await ctx.db.from("catalogue_items").select("*").eq("workspace_id", ctx.workspace.id).order("active", { ascending: false }).order("created_at", { ascending: false });
  const errors: Record<string, string> = { role: "Only owners and admins can edit the catalogue.", price: "Enter prices as numbers in naira, e.g. 3500.", intro: "The intro price must be lower than the normal price.", image: "Images must be PNG, JPG or WEBP under 4 MB.", save: "Couldn't save. Try again." };

  return (
    <>
      <div className="page-head"><div><h1>Catalogue</h1><p>Your assistant can only quote what&apos;s here, at these prices. Turn items off instead of deleting them so past orders stay intact.</p></div></div>
      {sp.saved && <div className="notice notice-ok" role="status">{sp.saved === "edit" ? "Updated. New prices apply to new orders; existing orders keep their price." : "Added. Your assistant can offer it now."}</div>}
      {sp.error && <div className="notice notice-bad" role="alert">{errors[sp.error] ?? "Something went wrong."}</div>}

      <details className="panel add" open={!items?.length}>
        <summary><span className="btn btn-ink">+ Add item</span></summary>
        <form action={addItem} style={{ display: "grid", gap: 14, marginTop: 16 }}>
          <div className="form-grid">
            <label className="field"><span>Name</span><input id="item-name" name="name" className="input" required maxLength={120} placeholder="Jollof + chicken (10 trays)" /></label>
            <label className="field"><span>Type</span><select id="item-kind" name="kind" className="input">{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <label className="field"><span>Price (₦)</span><input id="item-price" name="price" className="input" required inputMode="decimal" placeholder="35000" /></label>
            <label className="field"><span>Intro / promo price (₦)</span><input id="item-intro" name="intro_price" className="input" inputMode="decimal" placeholder="optional" /></label>
            <label className="field"><span>In stock / places</span><input id="item-stock" name="stock" type="number" min={0} className="input" placeholder="leave blank if unlimited" /></label>
            <label className="field"><span>Photo</span><input id="item-image" name="image" type="file" accept="image/png,image/jpeg,image/webp" className="input" /></label>
          </div>
          <label className="field"><span>Description</span><textarea id="item-desc" name="description" className="input" maxLength={1000} placeholder="What's included, sizes, delivery time…" /></label>
          <label className="field"><span>Terms</span><input id="item-terms" name="terms" className="input" maxLength={500} placeholder="e.g. Order 48 hours ahead. Delivery not included." /></label>
          <div><button className="btn btn-ink">Save item</button></div>
        </form>
      </details>

      {items?.length ? (
        <div className="table-wrap"><table>
          <thead><tr><th>Item</th><th>Type</th><th className="num">Price</th><th className="num">Stock</th><th>Status</th><th></th></tr></thead>
          <tbody>{items.map((i) => {
            const url = publicAssetUrl(i.image_path);
            return (
              <tr key={i.id} style={{ opacity: i.active ? 1 : 0.55 }}>
                <td><div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {url ? <img src={url} alt="" className="thumb" /> : <span className="thumb" />}
                  <div style={{ minWidth: 0 }}><b>{i.name}</b><div style={{ fontSize: 13, color: "var(--ink-50)" }}>{i.description?.slice(0, 80)}</div></div></div></td>
                <td>{KINDS.find((k) => k[0] === i.kind)?.[1]}</td>
                <td className="num">{i.intro_price_kobo != null ? <><s style={{ color: "var(--ink-50)" }}>{formatNaira(i.price_kobo)}</s><br />{formatNaira(i.intro_price_kobo)}</> : formatNaira(i.price_kobo)}</td>
                <td className="num">{i.stock ?? "∞"}</td>
                <td>{i.active ? <span className="chip chip-ok">On sale</span> : <span className="chip">Off</span>}</td>
                <td><div className="row-actions">
                  <details><summary className="btn btn-line btn-sm">Edit</summary>
                    <form action={editItem} style={{ display: "grid", gap: 8, marginTop: 8, minWidth: 200 }}>
                      <input type="hidden" name="id" value={i.id} />
                      <label className="field"><span>Price (₦)</span><input id={`p-${i.id}`} name="price" className="input" required defaultValue={i.price_kobo / 100} inputMode="decimal" /></label>
                      <label className="field"><span>Intro price (₦)</span><input id={`ip-${i.id}`} name="intro_price" className="input" defaultValue={i.intro_price_kobo != null ? i.intro_price_kobo / 100 : ""} inputMode="decimal" /></label>
                      <label className="field"><span>Stock</span><input id={`s-${i.id}`} name="stock" type="number" min={0} className="input" defaultValue={i.stock ?? ""} /></label>
                      <button className="btn btn-ink btn-sm">Save</button>
                    </form></details>
                  <form action={toggle}><input type="hidden" name="id" value={i.id} /><input type="hidden" name="active" value={String(!i.active)} /><button className="btn btn-line btn-sm">{i.active ? "Turn off" : "Turn on"}</button></form>
                </div></td>
              </tr>
            );
          })}</tbody>
        </table></div>
      ) : null}
    </>
  );
}
