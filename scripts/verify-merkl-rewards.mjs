// Merkl official API read-only: campaign mechanics and optional wallet reward observation.
// Wallet aggregated rewards never prove an individual LP position is eligible.
import {readFile,writeFile} from "node:fs/promises";
import {assessMerklCampaignRules,summarizeMerklRewards} from "../lp-verification-lib.js";
const get=async path=>{
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),12000);
 try {
  const r=await fetch("https://api.merkl.xyz"+path,{signal:ctrl.signal,
    headers:{Accept:"application/json"}});
  if(!r.ok)throw Error("MERKL_HTTP_"+r.status);
  return await r.json();
 }finally{clearTimeout(timer)}
};
const report={schema:"merkl-eligibility-v1",read_only:true,
 generated_at_ms:Date.now(),state:"BLOCKED_DATA",
 rules_state:"BLOCKED_DATA",user_rewards_state:"BLOCKED_NO_PUBLIC_WALLET",
 position_eligibility_verified:false,claimable_from_this_campaign_verified:false,
 best:null};
const data=JSON.parse(await readFile("lp-opportunities.json","utf8"));
const lead=data?.merkl?.research_leader;
if(!lead?.opportunity_id||!lead?.pool_identifier){
 report.state="BLOCKED_NO_RESEARCH_OPPORTUNITY";
}else{
 try {
  const id=encodeURIComponent(lead.opportunity_id);
  const detail=await get("/v4/opportunities/"+id+"?campaigns=true");
  if(String(detail?.id)!==lead.opportunity_id ||
      detail.identifier!==lead.pool_identifier||
      detail.chainId!==lead.chain_id ||detail.type!==lead.type||
      detail.status!=="LIVE")throw Error("MERKL_EXACT_IDENTITY_CHANGED");
  const rules=assessMerklCampaignRules(detail);
  report.state=rules.state==="RULES_VERIFIED_POSITION_UNKNOWN"
    ?"RULES_READ_PASS_POSITION_UNKNOWN":"BLOCKED_RULES";
  report.rules_state=rules.state;
  report.opportunity_id=String(detail.id);
  report.pool_identifier=String(detail.identifier);
  report.chain_id=detail.chainId;
  report.campaign_count=rules.active_campaigns;
  report.campaigns=rules.campaigns||[];
  report.apr_is_position_return=false;
  report.in_range_rules_read=true;
  report.position_eligibility_verified=false;
  report.claimable_from_this_campaign_verified=false;
  const wallet=process.env.MERKL_PUBLIC_WALLET_ADDRESS?.trim();
  if(wallet){
   if(!/^0x[0-9a-fA-F]{40}$/.test(wallet))throw Error("INVALID_PUBLIC_WALLET_ADDRESS");
   // Distribution chain may differ from pool's compute chain.
   const distributionChains=[...new Set((rules.campaigns||[])
     .map(c=>c.distribution_chain_id).filter(Number.isInteger))];
   if(!distributionChains.length)report.user_rewards_state="BLOCKED_NO_DISTRIBUTION_CHAIN";
   else {
    const observations=[];
    for(const chainId of distributionChains){
     const rewards=await get("/v4/users/"+wallet.toLowerCase()+"/rewards?chainId="+chainId);
     observations.push({chain_id:chainId,...summarizeMerklRewards(rewards,chainId)});
    }
    // A wallet may have claimable rewards from hundreds of unrelated campaigns.
    // It is never proof this exact V4 position receives its campaign.
    report.user_rewards_state="WALLET_AGGREGATE_OBSERVED_NOT_CAMPAIGN_PROOF";
    // Only write wallet-specific records to private ephemeral file, never stdout or git.
    await writeFile("lp-merkl-private.json",JSON.stringify({
      wallet,opportunity_id:lead.opportunity_id,observed_at_ms:Date.now(),
      rewards:observations,position_eligibility_verified:false
    },null,2)+"\n",{mode:0o600});
   }
  }
 }catch(e){
  report.state="BLOCKED_MERKL_DETAIL";
  report.error=String(e?.message||e).slice(0,160);
 }
}
report.generated_at_ms=Date.now();
await writeFile("lp-merkl-eligibility.json",JSON.stringify(report,null,2)+"\n");
console.log("MERKL_ELIGIBILITY",JSON.stringify({
 state:report.state,rules:report.rules_state,campaign_count:report.campaign_count,
 wallet:report.user_rewards_state,position_verified:report.position_eligibility_verified,
 error:report.error
}));
