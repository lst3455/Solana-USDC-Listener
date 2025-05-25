import { fetchAndProcessSolanaTransaction, storeTransactionInDb } from './index.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.test({
    name: "fetchAndProcessSolanaTransaction and storeTransactionInDb: integration test",
    fn: async () => {
        const testSignature = "5bnNV19Ms2ZJjajDzmFc7uXwNrgBmHduFHn7PZHp542WKoH6AWDtJHs5ZQAXPg563RszRu5WLRKMuaXtcjCNEENy";

        let testSupabaseClient: SupabaseClient | undefined;
        const supabaseUrlForTest = Deno.env.get("LOCAL_SUPABASE_URL");
        const supabaseServiceKeyForTest = Deno.env.get("LOCAL_SUPABASE_SERVICE_ROLE_KEY");
        console.log("Supabase URL for Test:", supabaseUrlForTest);
        console.log("Supabase Service Key for Test:", supabaseServiceKeyForTest);

        if (supabaseUrlForTest && supabaseServiceKeyForTest) {
            testSupabaseClient = createClient(supabaseUrlForTest, supabaseServiceKeyForTest);
        }

        const processedTxResult = await fetchAndProcessSolanaTransaction(testSignature);
        console.log("Processed Transaction Result:", processedTxResult);
        if (!processedTxResult) return;
    
        const { error: dbError } = await storeTransactionInDb(processedTxResult);
        console.log("Database Write Error:", dbError);

        if (testSupabaseClient && !dbError) {
            const { data: dbRecord, error: dbVerifyError } = await testSupabaseClient
                .from('solana_transactions')
                .select('*')
                .eq('signature', testSignature)
                .single();

            console.log("Database Record:", dbRecord);

            if (testSupabaseClient && dbRecord) { // dbRecord implies write was likely successful
                await testSupabaseClient
                    .from('solana_transactions')
                    .delete()
                    .eq('signature', processedTxResult.signature);
            }
        }
    },
    permissions: {
        env: [
            "SOLANA_RPC_URL", "USDC_MINT", "SOLANA_ADDR",
            "LOCAL_SUPABASE_URL", "LOCAL_SUPABASE_SERVICE_ROLE_KEY",
            "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"
        ],
        net: true,
    },
    sanitizeResources: false,
    sanitizeOps: false,
});