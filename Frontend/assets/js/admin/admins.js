(() => {
"use strict";
const $=id=>document.getElementById(id);
const api=window.FoodDeliveryAuthApi;
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function request(path,options={}){if(!api||!api.request)throw new Error("Secure API client is unavailable.");return api.request(path,{...options,authenticated:true});}
async function loadAdmins(){ $("listStatus").textContent="Loading administrator accounts…";try{const r=await request("/admins?status=all&limit=100");const d=r.data||r;const rows=d.admins||[];$("adminRows").innerHTML=rows.length?rows.map(a=>'<tr><td>'+esc(a.id)+'</td><td>'+esc([a.first_name,a.last_name].filter(Boolean).join(" "))+'</td><td>'+esc(a.email)+'</td><td>'+((a.is_active)?'Active':'Inactive')+'</td><td>'+esc(a.created_at?new Date(a.created_at).toLocaleDateString():"—")+'</td><td><button class="account-action '+(a.is_active?'danger':'')+'" data-id="'+esc(a.id)+'" data-action="'+(a.is_active?'deactivate':'activate')+'">'+(a.is_active?'Deactivate':'Activate')+'</button></td></tr>').join(""):'<tr><td colspan="6">No regular admin accounts found.</td></tr>';$("listStatus").textContent=rows.length+" admin account(s).";}catch(e){$("adminRows").innerHTML="";$("listStatus").textContent=e.message||"Failed to load admins.";}}
$("createAdminForm").addEventListener("submit",async e=>{e.preventDefault();const form=e.currentTarget;const button=$("createAdminButton");button.disabled=true;$("createStatus").textContent="Creating account…";try{const body=Object.fromEntries(new FormData(form).entries());await request("/admins",{method:"POST",body});form.reset();$("createStatus").textContent="Admin account created successfully.";await loadAdmins();}catch(err){$("createStatus").textContent=err.message||"Could not create admin account.";}finally{button.disabled=false;}});
$("adminRows").addEventListener("click",async e=>{const b=e.target.closest("button[data-action]");if(!b)return;const action=b.dataset.action,id=b.dataset.id;if(!confirm((action==="deactivate"?"Deactivate":"Activate")+" admin account #"+id+"?"))return;b.disabled=true;try{if(action==="deactivate")await request("/admins/"+encodeURIComponent(id),{method:"DELETE"});else await request("/admins/"+encodeURIComponent(id)+"/activate",{method:"PATCH"});await loadAdmins();}catch(err){$("listStatus").textContent=err.message||"Admin account update failed.";}finally{b.disabled=false;}});
$("refreshAdmins").addEventListener("click",loadAdmins);
async function initializeSuperAdminPage(){
    const container=document.querySelector(".super-admin-accounts");
    try{
        const response=await request("/auth/me");
        const user=(response.data&&response.data.user)||response.user||{};
        if(user.role!=="super_admin"){
            container.innerHTML="<h2>Access denied</h2><p>Only the super admin can access this page.</p>";
            return;
        }
        if(user.first_name)$("superAdminName").textContent=[user.first_name,user.last_name].filter(Boolean).join(" ");
        await loadAdmins();
    }catch(error){
        container.innerHTML="<h2>Unable to verify access</h2><p>"+esc(error.message||"Please sign in again.")+"</p>";
    }
}
initializeSuperAdminPage();
})();