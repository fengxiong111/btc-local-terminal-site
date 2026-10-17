// Meteora DLMM official SDK: read-only active bins, optional public position,
// and swapQuote. NO transaction builders, no signing, no RPC writes.
import {readFile,writeFile,chmod} from "node:fs/promises";
import DLMM from "@meteora-ag/dlmm";
import {Connection,PublicKey} from "@solana/web3.js";
import BN from "bn.js";
import {summarizeMeteoraBins,assessMeteoraSwapQuote} from "../../lp-verification-lib.js";

const USD_MINTS=new Set([
 "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // Circle USDC
 "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // Tether USDT
 "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH" // Paxos USDG
]);
const asAddr=x=>x?.toBase58?.()||String(x??"");
const raw=x=>typeof x==="string"&&/^\d+$/.test(x)?x:
  (x?.toString?.()&&/^\d+$/.test(x.toString()))?x.toString():null;
const report={schema:"meteora-sdk-read-v1",read_only:true,
  generated_at_ms:Date.now(),state:"BLOCKED_DATA",pool:null,
  sdk_version:"1.9.14",position_state:"BLOCKED_NO_PUBLIC_POSITION",
  exit_state:"BLOCKED_NO_POSITION",best:null};
const data=JSON.parse(await readFile("lp-opportunities.json","utf8"));
const leader=data?.meteora?.research_leader;
const poolId=process.env.LP_METEORA_POOL_ADDRESS||leader?.address;
if(!poolId){
 report.state="BLOCKED_NO_RESEARCH_POOL";
} else {
 try{
  const address=new PublicKey(poolId).toBase58();
  const rpc=process.env.SOLANA_RPC_URL||"https://api.mainnet-beta.solana.com";
  if(!/^https:\/\//.test(rpc))throw Error("RPC_MUST_BE_HTTPS");
  const connection=new Connection(rpc,{commitment:"confirmed",disableRetryOnRateLimit:true});
  const client=await DLMM.create(connection,new PublicKey(address),{cluster:"mainnet-beta"});
  const active=await client.getActiveBin();
  const surrounding=await client.getBinsAroundActiveBin(8,8);
  const xMint=asAddr(client.tokenX?.mint?.address||client.tokenX?.publicKey);
  const yMint=asAddr(client.tokenY?.mint?.address||client.tokenY?.publicKey);
  if(!xMint||!yMint)throw Error("SDK_TOKEN_MINT_MISSING");
  report.pool=address;report.token_mints=[xMint,yMint];
  const posAddress=process.env.LP_METEORA_POSITION_ADDRESS?.trim();
  let pos=null;
  if(posAddress){
   pos=await client.getPosition(new PublicKey(posAddress));
   if(!pos?.positionData)throw Error("POSITION_DATA_MISSING");
  }
  const normalized=summarizeMeteoraBins(active,surrounding?.bins||[],pos?.positionData||null);
  if(normalized.state!=="ACTIVE_BIN_OBSERVED")throw Error(normalized.state);
  report.state="BIN_READ_PASS";
  report.active_bin_id=normalized.active_bin_id;
  report.active_bin_price=normalized.active_price_per_token;
  report.active_bin_x_raw=normalized.active_bin_x_raw;
  report.active_bin_y_raw=normalized.active_bin_y_raw;
  report.active_bin_liquidity_raw=normalized.active_bin_liquidity_raw;
  report.sampled_bins=normalized.sampled_bins;
  report.nonempty_bins=normalized.nonempty_bins;
  report.position_state=pos?"POSITION_READ_PRIVATE":"BLOCKED_NO_PUBLIC_POSITION";
  const positionSummary=pos?normalized:null;
  // Only one raw LP leg can be swapped inside this pool. With no position,
  // a one-token SDK reference quote probes liquidity; never call it "exit".
  const stableX=USD_MINTS.has(xMint),stableY=USD_MINTS.has(yMint);
  const oneHopStable=stableX!==stableY;
  const swapForY=stableY;
  const sourceMint=swapForY?xMint:yMint;
  const sourceDec=Number(swapForY?client.tokenX?.mint?.decimals:client.tokenY?.mint?.decimals);
  const sourceRaw=pos ? raw(swapForY?pos.positionData.totalXAmount:pos.positionData.totalYAmount):
    (Number.isInteger(sourceDec)&&sourceDec>=0&&sourceDec<=12
      ? 10n**BigInt(sourceDec) : 0n).toString();
  const quoteKind=pos?"POSITION_PRINCIPAL_SWAP_ONLY":"ONE_TOKEN_REFERENCE_ONLY";
  if(sourceRaw&&BigInt(sourceRaw)>0n) {
   try{
    const arrays=await client.getBinArrayForSwap(swapForY,8);
    const quote=client.swapQuote(new BN(sourceRaw),swapForY,new BN(50),arrays,false);
    const assessed=assessMeteoraSwapQuote(quote,sourceRaw,
      {stableOutput:oneHopStable,slippageBps:50});
    report.reference_quote_state=assessed.state;
    report.reference_quote_type=quoteKind;
    report.reference_quote_source_mint=sourceMint;
    report.reference_quote_output_raw=assessed.min_output_raw??null;
    report.reference_quote_consumed_full=assessed.state!=="BLOCKED_PARTIAL_FILL"&&
      assessed.state!=="BLOCKED_QUOTE_SCHEMA";
    report.exit_state=pos&&oneHopStable&&assessed.state==="SINGLE_HOP_STABLE_SWAP_QUOTED"
       ? "SINGLE_HOP_SWAP_QUOTED_WITHOUT_WITHDRAW_SIMULATION"
       : pos?"BLOCKED_FULL_STABLE_EXIT":"BLOCKED_NO_POSITION";
    if(pos&&oneHopStable&&assessed.state==="SINGLE_HOP_STABLE_SWAP_QUOTED")
      report.exit_stable_min_raw=assessed.min_output_raw;
   }catch(err){
    report.reference_quote_state="BLOCKED_SDK_QUOTE";
    report.reference_quote_error=String(err?.message||err).slice(0,130);
    report.exit_state="BLOCKED_SDK_QUOTE";
   }
  }else{
   report.reference_quote_state="BLOCKED_NO_INPUT_AMOUNT";
   report.exit_state=pos?"BLOCKED_ZERO_SWAP_INPUT":"BLOCKED_NO_POSITION";
  }
  report.full_lp_withdrawal_verified=false;
  report.same_slot_exit_verified=false;
  report.net_edge_state="UNKNOWN_NO_FULL_POSITION_EXIT_SIMULATION";
  // Private position balances/fees never enter public GitHub artifact or logs.
  if(positionSummary){
   const privateFile="lp-position-private.json";
   await writeFile(privateFile,JSON.stringify({
    schema:"private-position-evidence-v1",generated_at_ms:Date.now(),
    position_address:posAddress,pool:address,public_sdk_state:report.state,
    position_data:positionSummary,exit_state:report.exit_state,
    estimated_single_hop_min_output_raw:report.exit_stable_min_raw??null,
    full_lp_withdrawal_verified:false
   },null,2)+"\n",{mode:0o600});
   await chmod(privateFile,0o600);
  }
 }catch(err){
  report.state="BLOCKED_SDK_OR_RPC";
  report.error=String(err?.cause?.code||err?.message||err).slice(0,180);
 }
}
report.generated_at_ms=Date.now();
await writeFile("lp-meteora-sdk.json",JSON.stringify(report,null,2)+"\n");
console.log("METEORA_SDK",JSON.stringify({
 state:report.state,pool:report.pool,active:report.active_bin_id,
 sampled_bins:report.sampled_bins,position_state:report.position_state,
 reference_quote:report.reference_quote_state,exit_state:report.exit_state,
 error:report.error
}));
