# Solana Transaction Listener with Supabase

This project provides a Supabase Edge Function that:

1.  **Webhook Listener**: Receives transaction signatures (e.g., from Helius, Alchemy, or other webhook providers) and processes these Solana transactions to find relevant token (e.g., USDC or SOL) balance changes for a specified address.
2.  **Stores Data**: Saves the processed transaction details (signature, balance changes, timestamp) into a Supabase database table.
3.  **Query Endpoint**: Provides a GET endpoint to fetch processed transaction details by its signature, first checking the database and then falling back to the Solana RPC if not found.

This replaces a traditional server setup with a serverless Supabase Edge Function.



## Prerequisites

*   **Deno**: [Install Deno](https://deno.land/manual/getting_started/installation) (the runtime for Supabase Edge Functions).
*   **Supabase Account**: A free account at [supabase.com](https://supabase.com/).
*   **Supabase CLI**: [Install the Supabase CLI](https://supabase.com/docs/guides/cli/getting-started).
*   **Solana Wallet Address**: The address you want to monitor for transactions.
*   **Solana RPC URL**: A reliable Solana RPC endpoint. Public ones are heavily rate-limited. Consider providers like QuickNode, Alchemy, Helius, or Triton.
*   **(Optional) Webhook Provider**: A service that can send transaction signatures to your Edge Function's webhook endpoint (e.g., Helius, Alchemy Address Activity).


## 1. Supabase Project Setup

1.  **Create a New Supabase Project**:
    *   Go to [supabase.com](https://supabase.com/) and create a new project.
    *   Note your **Project URL** and **Service Role Key** (from Project Settings > API).

2.  **Create Database Table**:
    *   In your Supabase project dashboard, go to the "SQL Editor".
    *   Click "New query" and run the following SQL to create the `solana_transactions` table:

    ```sql
    CREATE TABLE public.solana_transactions (
        id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
        signature TEXT NOT NULL UNIQUE,
        pre_amount DOUBLE PRECISION NOT NULL,
        post_amount DOUBLE PRECISION NOT NULL,
        ui_amount DOUBLE PRECISION NOT NULL,
        transaction_timestamp TIMESTAMPTZ NULL,
        processed_at TIMESTAMPTZ DEFAULT now() NOT NULL
    );

    -- Optional: Add an index for faster lookups by signature
    CREATE INDEX idx_solana_transactions_signature ON public.solana_transactions(signature);

    -- Enable Row Level Security (RLS) - good practice, though service_role key bypasses it.
    ALTER TABLE public.solana_transactions ENABLE ROW LEVEL SECURITY;
    ```


## 2. Local Project Setup

1.  **Clone or Create Project Directory**:
    ```bash
    git clone https://github.com/lst3455/Solana-usdc-listener.git # Or your new repo
    cd Solana-usdc-listener
    ```
    (If starting fresh, create a new directory and `cd` into it.)

2.  **Initialize Supabase Locally**:
    ```bash
    npx supabase init
    ```
    This creates a `supabase` folder.

3.  **Link to Your Remote Supabase Project**:
    ```bash
    npx supabase login
    # Follow prompts, then (replace YOUR_PROJECT_ID):
    npx supabase link --project-ref YOUR_PROJECT_ID
    ```
    (Find `YOUR_PROJECT_ID` in your Supabase project's dashboard URL.)

4.  **Create the Edge Function**:
    We'll name the function `solana-transaction-handler`.
    ```bash
    supabase functions new solana-transaction-handler
    ```
    This creates `supabase/functions/solana-transaction-handler/index.ts`. Replace the content of this `index.ts` with the provided Edge Function code.


## 3. Environment Variables

Edge Functions use secrets for sensitive data.

1.  **For Local Development (`supabase/.env.local` file)**:
    Create a file named `.env.local` inside the `supabase` directory (`supabase/.env.local`). **This file should be in your `.gitignore`**.
    ```dotenv
    # supabase/.env.local
    # For Supabase client initialization locally
    LOCAL_SUPABASE_URL="YOUR_SUPABASE_PROJECT_URL"
    LOCAL_SUPABASE_SERVICE_ROLE_KEY="YOUR_SUPABASE_PROJECT_SERVICE_ROLE_KEY"

    # For Solana connection and logic
    SOLANA_RPC_URL="YOUR_RELIABLE_SOLANA_RPC_URL"
    USDC_MINT="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" 
    SOLANA_ADDR="YOUR_SOLANA_WALLET_ADDRESS_TO_MONITOR"
    ```

## 4. Running Locally

1.  **Serve the Function**:
    From your project root directory:
    ```bash
    supabase functions serve --env-file ./supabase/.env.local --no-verify-jwt
    ```
    *   `--env-file ./supabase/.env.local`: Loads your local environment variables.
    *   `--no-verify-jwt`: Disables JWT authentication for easier local testing, especially for webhooks.

    The function will typically be available at:
    *   Webhook: `POST http://localhost:54321/functions/v1/solana-transaction-handler/webhook`
    *   Get Transaction: `GET http://localhost:54321/functions/v1/solana-transaction-handler/transaction/:signature`

2.  **Testing**:
    *   **Webhook (POST)**: Use `curl` or Postman.
        ```bash
        curl -X POST \
          http://localhost:54321/functions/v1/solana-transaction-handler/webhook \
          -H "Content-Type: application/json" \
          -d '{"signature": "YOUR_TX_SIGNATURE_HERE"}'
        ```
    *   **Get Transaction (GET)**:
        ```bash
        curl http://localhost:54321/functions/v1/solana-transaction-handler/transaction/YOUR_TX_SIGNATURE_HERE
        ```


## 5. Integration Testing (Optional)

You can run integration tests using Deno. See the example `fetchAndProcessSolanaTransaction.test.ts`.

1.  **Run the test command**:
    Navigate to your project root. using a `.env` file (e.g., `supabase/.env.local`):
    ```bash
    deno test --allow-env --allow-net --env=supabase/.env.local supabase/functions/solana-transaction-handler/fetchAndProcessSolanaTransaction.test.ts
    ```

---