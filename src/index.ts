import express, { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import { Connection, clusterApiUrl, ParsedTransactionWithMeta } from '@solana/web3.js';

dotenv.config();

const app = express();
app.use(express.json());

const connection = new Connection(
    process.env.SOLANA_RPC_URL || clusterApiUrl('mainnet-beta'),
    'confirmed'
);

interface TransactionResult {
    signature: string;
    preAmount: number;
    postAmount: number;
    uiAmount: number;
    timestamp: string | null;
}

async function processTransaction(signature: string): Promise<TransactionResult | null> {
    const tx: ParsedTransactionWithMeta | null = await connection.getParsedTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0
    });

    if (!tx || !tx.meta || !process.env.USDC_MINT || !process.env.SOLANA_ADDR) {
        return null;
    }

    const preBalance = tx.meta.preTokenBalances?.find(balance => 
        (balance.mint || '') === process.env.USDC_MINT && 
        (balance.owner || '') === process.env.SOLANA_ADDR
    );

    const postBalance = tx.meta.postTokenBalances?.find(balance => 
        (balance.mint || '') === process.env.USDC_MINT && 
        (balance.owner || '') === process.env.SOLANA_ADDR
    );

    const preAmount = preBalance?.uiTokenAmount.uiAmountString
        ? parseFloat(preBalance.uiTokenAmount.uiAmountString)
        : 0;

    const postAmount = postBalance?.uiTokenAmount.uiAmountString
        ? parseFloat(postBalance.uiTokenAmount.uiAmountString)
        : 0;

    const uiAmount = postAmount - preAmount;
    
    return {
        signature,
        preAmount,
        postAmount,
        uiAmount,
        timestamp: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null
    };
}

app.post(
    '/api/webhook',
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            // console.dir(req.body, { depth: null, colors: true });
            
            const signature = req.body.event?.transaction?.[0]?.signature as string;
            if (!signature) {
                console.warn('↪ No signature found in webhook payload');
                res.sendStatus(400);
                return;
            }

            const result = await processTransaction(signature);
            
            if (!result) {
                console.warn(`↪ Transaction ${signature} not found or missing metadata`);
                res.sendStatus(404);
                return;
            }

            console.log(`↪ USDC balance change ${result.uiAmount}, from ${result.preAmount} to ${result.postAmount}, tx: ${signature}`);
            res.sendStatus(200);
        } catch (err) {
            next(err);
        }
    }
);

app.get(
    '/api/tx/:signature',
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { signature } = req.params;

            if (!signature) {
                res.status(400).json({ error: 'Transaction signature is required' });
                return;
            }

            const result = await processTransaction(signature);
            
            if (!result) {
                console.warn(`↪ Transaction ${signature} not found or missing metadata`);
                res.sendStatus(404);
                return;
            }

            res.status(200).json({
                signature: result.signature,
                tokenTransfers: result.uiAmount,
                timestamp: result.timestamp
            });
        } catch (err) {
            console.error('Error fetching transaction:', err);
            next(err);
        }
    }
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Listening on http://localhost:${PORT}`);
});
