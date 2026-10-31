(() => {
 "use strict";
 const $ = id => document.getElementById(id);
 let page = 1, pages = 1, loading = false;
 const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
 const api = () => window.FoodDeliveryAuthApi;
 async function requestPage(targetPage, limit) {
   const client = api();
   if (!client || typeof client.request !== "function") throw new Error("The secure API client did not load. Refresh the page and try again.");
   if (typeof client.getToken === "function" && !client.getToken()) throw new Error("Your admin session is missing or has expired. Sign in again.");
   const params = new URLSearchParams({page:String(targetPage),limit:String(limit),search:$("search").value.trim(),type:$("type").value});
   const result = await client.request("/admins/deleted-accounts?" + params.toString(), {authenticated:true});
   if (result?.success === false) throw new Error(result.message || "The server could not load deleted-account records.");
   const data = result?.data || result;
   if (!data || !Array.isArray(data.accounts)) throw new Error("The server response did not contain a deleted-accounts list. Check the deployed backend version.");
   return data;
 }
 function renderRows(rows) {
   $("rows").innerHTML = rows.length ? rows.map(row => '<tr><td>'+esc(row.deleted_at ? new Date(row.deleted_at).toLocaleString() : "—")+'</td><td>'+esc(row.account_type || "—")+'</td><td>'+esc(row.original_account_id ?? "—")+'</td><td>'+esc(row.account_label || "—")+'</td><td>'+esc(row.deleted_by_label || (row.deleted_by ? "Admin #"+row.deleted_by : "—"))+'</td><td>'+esc(row.deletion_reason || "—")+'</td></tr>').join("") : '<tr><td class="deleted-empty" colspan="6">No deleted accounts match these filters.</td></tr>';
 }
 async function load() {
   if (loading) return;
   loading = true;
   $("apply").disabled = true; $("export").disabled = true;
   $("status").classList.remove("error"); $("status").textContent = "Loading deleted accounts…";
   try {
     let data = await requestPage(page, 25);
     let pagination = data.pagination || {};
     pages = Math.max(1, Number(pagination.pages) || 1);
     if (page > pages) { page = pages; data = await requestPage(page, 25); pagination = data.pagination || {}; pages = Math.max(1, Number(pagination.pages) || 1); }
     const rows = data.accounts || [];
     renderRows(rows);
     $("status").textContent = Number(pagination.total ?? rows.length) + " deleted account(s) found.";
     $("pageLabel").textContent = "Page " + page + " of " + pages;
     $("prev").disabled = page <= 1; $("next").disabled = page >= pages;
   } catch (error) {
     renderRows([]);
     $("status").classList.add("error");
     $("status").textContent = (error?.message || "Unable to load deleted accounts.") + " Use Search to retry.";
     $("pageLabel").textContent = "Page " + page;
     $("prev").disabled = page <= 1; $("next").disabled = true;
     console.error("Deleted Accounts page load failed:", error);
   } finally { loading = false; $("apply").disabled = false; $("export").disabled = false; }
 }
 function csvCell(value) {
   let text = String(value ?? "");
   if (/^[\u0000-\u0020]*[=+@-]/.test(text)) text = "'" + text;
   return '"' + text.replace(/"/g, '""') + '"';
 }
 async function exportAllMatching() {
   if (loading) return;
   loading = true; $("export").disabled = $("apply").disabled = true; $("export").textContent = "Exporting…";
   try {
     const all = []; let exportPage = 1, exportPages = 1;
     do {
       const data = await requestPage(exportPage, 100), pagination = data.pagination || {};
       all.push(...data.accounts); exportPages = Math.max(1, Number(pagination.pages) || 1); exportPage++;
     } while (exportPage <= exportPages);
     if (!all.length) { $("status").textContent = "No matching deleted accounts to export."; return; }
     const columns = [["deleted_at","Deleted at"],["account_type","Account type"],["original_account_id","Original account ID"],["account_label","Account"],["deleted_by_label","Deleted by"],["deletion_reason","Deletion reason"]];
     const csv = [columns.map(col => csvCell(col[1])).join(","), ...all.map(row => columns.map(col => csvCell(col[0] === "deleted_at" && row[col[0]] ? new Date(row[col[0]]).toISOString() : (col[0] === "deleted_by_label" ? (row.deleted_by_label || (row.deleted_by ? "Admin #" + row.deleted_by : "")) : row[col[0]]) )).join(","))].join("\r\n");
     const url = URL.createObjectURL(new Blob(["\ufeff", csv], {type:"text/csv;charset=utf-8"}));
     const link = document.createElement("a"); link.href = url; link.download = "deleted-accounts-" + new Date().toISOString().slice(0,10) + ".csv"; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
     $("status").textContent = "Exported " + all.length + " audit record(s).";
   } catch (error) { $("status").classList.add("error"); $("status").textContent = (error?.message || "Export failed.") + " Retry the export."; console.error("Deleted Accounts export failed:", error); }
   finally { loading = false; $("export").disabled = $("apply").disabled = false; $("export").textContent = "Export All Matching CSV"; }
 }
 $("apply").addEventListener("click", () => { page = 1; load(); });
 $("search").addEventListener("keydown", event => { if (event.key === "Enter") { page = 1; load(); } });
 $("type").addEventListener("change", () => { page = 1; load(); });
 $("prev").addEventListener("click", () => { if (page > 1) { page--; load(); } });
 $("next").addEventListener("click", () => { if (page < pages) { page++; load(); } });
 $("export").addEventListener("click", exportAllMatching);
 if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load, {once:true}); else load();
})();
