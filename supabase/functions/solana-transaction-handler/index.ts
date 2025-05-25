// Supabase Edge Function: solana-transaction-handler/index.ts

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { Connection, clusterApiUrl, ParsedTransactionWithMeta, LAMPORTS_PER_SOL } from 'npm:@solana/web3.js@^1.98.2'

// --- Type Definitions ---
interface TransactionResult {
  signature: string;
  preAmount: number;
  postAmount: number;
  uiAmount: number; // The change in balance
  timestamp: string | null;
}

interface StoredTransactionData {
  signature: string;
  pre_amount: number;
  post_amount: number;
  ui_amount: number;
  transaction_timestamp: string | null;
}

// --- Environment Variable Retrieval & Client Initialization ---

// For local development, use LOCAL_ prefixed vars in .env.local to avoid Supabase CLI stripping them
const LOCAL_DEV_SUPABASE_URL = Deno.env.get('LOCAL_SUPABASE_URL');
const LOCAL_DEV_SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('LOCAL_SUPABASE_SERVICE_ROLE_KEY');

// For deployed environment, these are standard and injected by Supabase (set as secrets)
const DEPLOYED_SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const DEPLOYED_SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

// Determine the actual URL and Key to use
const supabaseUrlToUse = LOCAL_DEV_SUPABASE_URL || DEPLOYED_SUPABASE_URL;
const supabaseServiceKeyToUse = LOCAL_DEV_SUPABASE_SERVICE_ROLE_KEY || DEPLOYED_SUPABASE_SERVICE_ROLE_KEY;

const SOLANA_RPC_URL = Deno.env.get("SOLANA_RPC_URL") || clusterApiUrl('mainnet-beta');
const USDC_MINT = Deno.env.get("USDC_MINT");
const SOLANA_ADDR = Deno.env.get("SOLANA_ADDR");

let supabaseClient: SupabaseClient;
if (supabaseUrlToUse && supabaseServiceKeyToUse) {
  supabaseClient = createClient(supabaseUrlToUse, supabaseServiceKeyToUse);
  console.info("Supabase client initialized.");
} else {
  console.error("Supabase URL or Service Role Key NOT RESOLVED for client initialization. Database operations will likely fail.");
  if (!supabaseUrlToUse) console.error("  Reason: Supabase URL is missing. Check LOCAL_SUPABASE_URL (local .env.local) or SUPABASE_URL (deployed env/secret).");
  if (!supabaseServiceKeyToUse) console.error("  Reason: Supabase Service Role Key is missing. Check LOCAL_SUPABASE_SERVICE_ROLE_KEY (local .env.local) or SUPABASE_SERVICE_ROLE_KEY (deployed secret).");
}

const solanaConnection = new Connection(SOLANA_RPC_URL, 'confirmed');

// --- Solana Transaction Processing Logic (remains the same) ---
async function fetchAndProcessSolanaTransaction(signature: string): Promise<TransactionResult | null> {
  if (!USDC_MINT || !SOLANA_ADDR) {
    console.error("USDC_MINT or SOLANA_ADDR environment variables not set for transaction processing.");
    return null;
  }
  const tx: ParsedTransactionWithMeta | null = await solanaConnection.getParsedTransaction(signature, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0
  });
  if (!tx || !tx.meta) {
    console.warn(`Transaction ${signature} not found on Solana or missing metadata.`);
    return null;
  }
  let preAmount = 0;
  let postAmount = 0;
  if (USDC_MINT.toUpperCase() === 'SOL') {
    const accountIndex = tx.transaction.message.accountKeys.findIndex(acc => acc.pubkey.toBase58() === SOLANA_ADDR);
    if (accountIndex !== -1) {
      preAmount = (tx.meta.preBalances[accountIndex] || 0) / LAMPORTS_PER_SOL;
      postAmount = (tx.meta.postBalances[accountIndex] || 0) / LAMPORTS_PER_SOL;
    }
  } else {
    const preBalance = tx.meta.preTokenBalances?.find(b => b.mint === USDC_MINT && b.owner === SOLANA_ADDR);
    const postBalance = tx.meta.postTokenBalances?.find(b => b.mint === USDC_MINT && b.owner === SOLANA_ADDR);
    preAmount = preBalance?.uiTokenAmount?.uiAmountString ? parseFloat(preBalance.uiTokenAmount.uiAmountString) : 0;
    postAmount = postBalance?.uiTokenAmount?.uiAmountString ? parseFloat(postBalance.uiTokenAmount.uiAmountString) : 0;
  }
  const uiAmount = postAmount - preAmount;
  return {
    signature,
    preAmount,
    postAmount,
    uiAmount,
    timestamp: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null
  };
}

// --- Supabase Database Interaction Logic (remains the same) ---
async function storeTransactionInDb(transaction: TransactionResult): Promise<{ error: any }> {
  if (!supabaseClient) return { error: { message: "Supabase client not initialized." }};
  const dataToStore: StoredTransactionData = {
    signature: transaction.signature,
    pre_amount: transaction.preAmount,
    post_amount: transaction.postAmount,
    ui_amount: transaction.uiAmount,
    transaction_timestamp: transaction.timestamp
  };
  const { error } = await supabaseClient
    .from('solana_transactions')
    .upsert(dataToStore, { onConflict: 'signature' });
  return { error };
}

async function fetchTransactionFromDb(signature: string): Promise<{ data: StoredTransactionData | null, error: any }> {
  if (!supabaseClient) return { data: null, error: { message: "Supabase client not initialized." }};
  const { data, error } = await supabaseClient
    .from('solana_transactions')
    .select('signature, ui_amount, transaction_timestamp, pre_amount, post_amount')
    .eq('signature', signature)
    .single();
  if (error && error.code === 'PGRST116') {
    return { data: null, error: null }; 
  }
  return { data, error };
}

// --- HTTP Utility Functions (remains the same) ---
function createJsonResponse(body: unknown, status: number = 200, headers?: HeadersInit) {
  const defaultHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...defaultHeaders, ...headers },
  });
}

// --- Request Handlers (remains the same) ---
async function handleWebhookPost(req: Request): Promise<Response> {
  let signature: string | undefined;
  try {
    const body = await req.json();
    if (Array.isArray(body) && body.length > 0 && body[0].signature) signature = body[0].signature;
    else if (body.event?.transaction?.[0]?.signature) signature = body.event.transaction[0].signature;
    else if (body.signature) signature = body.signature;

    if (!signature) {
      console.warn('Webhook: No signature found in payload.');
      return createJsonResponse({ error: 'No signature found in webhook payload' }, 400);
    }
  } catch (e) {
    console.error("Webhook: Error parsing JSON body:", (e as Error).message);
    return createJsonResponse({ error: 'Invalid JSON payload' }, 400);
  }

  console.info(`Webhook: Processing signature: ${signature}`);
  const processedTx = await fetchAndProcessSolanaTransaction(signature);

  if (!processedTx) {
    return createJsonResponse({ message: `Transaction ${signature} not processed or missing relevant data` }, 404);
  }

  const { error: dbError } = await storeTransactionInDb(processedTx);
  if (dbError) {
    console.error(`Webhook: Supabase store error for ${signature}:`, (dbError as Error).message);
    return createJsonResponse({ error: 'Failed to store transaction data', details: (dbError as Error).message }, 500);
  }

  console.info(`Webhook: Transaction ${signature} processed and stored. Change: ${processedTx.uiAmount}`);
  return createJsonResponse({ message: 'Webhook processed successfully', data: processedTx }, 200);
}

async function handleGetTransaction(signature: string): Promise<Response> {
  if (!signature) { // Should be caught by router, but good practice
    return createJsonResponse({ error: 'Transaction signature is required' }, 400);
  }

  const liveTx = await fetchAndProcessSolanaTransaction(signature);

  if (!liveTx) {
    return createJsonResponse({ error: `Transaction ${signature} not found on Solana or missing relevant metadata` }, 404);
  }
  
  console.info(`GET /transaction: Transaction ${signature} fetched live from Solana.`);
  return createJsonResponse({
    signature: liveTx.signature,
    tokenTransfers: liveTx.uiAmount,
    timestamp: liveTx.timestamp,
    source: 'live_solana_api'
  }, 200);
}

// --- Main Server Logic (UPDATED ROUTING) ---
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return createJsonResponse(null, 204);
  }

  const url = new URL(req.url);
  const envFunctionName = Deno.env.get("SUPABASE_FUNCTION_NAME");
  const functionName = envFunctionName || "solana-transaction-handler"; 

  console.log(`[Router DEBUG] Initial req.url: ${req.url}, Initial url.pathname: ${url.pathname}`);

  const deployedBasePath = `/functions/v1/${functionName}`;
  const localBasePath = `/${functionName}`; // Path structure observed in local `supabase functions serve`

  let relativePath = url.pathname; // This is the path part after the function name.
  if (relativePath.startsWith(deployedBasePath)) {
    relativePath = relativePath.substring(deployedBasePath.length) || "/";
  } else if (relativePath.startsWith(localBasePath)) {
    relativePath = relativePath.substring(localBasePath.length) || "/";
  } else {
    console.warn(`[Router] Path "${url.pathname}" did not start with known base paths ("${deployedBasePath}" or "${localBasePath}"). Assuming it's relative to function root.`);
    // If path is like "/webhook" directly, relativePath will still be "/webhook"
  }
  console.log(`[Router DEBUG] Calculated relativePath for routing: "${relativePath}"`);

  // Split relativePath into segments, removing empty strings from leading/trailing slashes
  // e.g., "/webhook" -> ["webhook"], "/transaction/sig123" -> ["transaction", "sig123"]
  const pathSegments = relativePath.split('/').filter(segment => segment.length > 0);
  const mainRouteSegment = pathSegments[0] || ''; // e.g., "webhook", "transaction"

  console.log(`[Router DEBUG] mainRouteSegment: "${mainRouteSegment}", pathSegments: ${JSON.stringify(pathSegments)}`);

  try {
    if (req.method === 'POST' && mainRouteSegment === 'webhook' && pathSegments.length === 1) {
      // Matches POST /functions/v1/solana-transaction-handler/webhook
      console.info(`Handling POST /webhook`);
      return await handleWebhookPost(req);
    } else if (req.method === 'GET' && mainRouteSegment === 'transaction' && pathSegments.length === 2) {
      // Matches GET /functions/v1/solana-transaction-handler/transaction/:signature
      const signature = pathSegments[1];
      if (signature) {
        console.info(`Handling GET /transaction/${signature}`);
        return await handleGetTransaction(signature);
      } else {
        // This case should ideally not be hit if pathSegments.length === 2 check is correct
        console.warn(`GET /transaction: Signature segment missing or empty.`);
        return createJsonResponse({ error: 'Signature is required after /transaction/' }, 400);
      }
    }

    // If no specific new routes matched
    console.warn(`Router: No specific route matched for ${req.method} ${url.pathname} (relativePath: ${relativePath}, mainRouteSegment: ${mainRouteSegment}). Returning 404.`);
    const availableRoutesMessage = `Available routes: POST /${functionName}/webhook, GET /${functionName}/transaction/:signature`;
    return createJsonResponse({ error: `Not Found. ${availableRoutesMessage}` }, 404);

  } catch (err) {
    const error = err as Error;
    console.error('Unhandled application error:', error.message);
    if (error.stack) { console.error(error.stack); }
    return createJsonResponse({ error: 'Internal Server Error', details: error.message }, 500);
  }
});

console.log(`Solana Transaction Handler function started. Monitoring USDC_MINT: ${USDC_MINT || 'N/A'} for address: ${SOLANA_ADDR || 'N/A'}`);
export { fetchAndProcessSolanaTransaction,storeTransactionInDb };
