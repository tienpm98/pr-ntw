import path from "path";
import { failed } from "@scripts/utils/console";
import {
  executeAllWalletsInParallel,
  loadWalletManager,
  WalletInstance,
} from "@scripts/utils/batchWallet";
import { register } from "@scripts/pharosNetwork/pns";

const baseDir = path.resolve(__dirname, "../../");

/**
 * Perform PNS registration operations for a single wallet in parallel
 */
async function registerPnsForWallet(wallet: WalletInstance, index: number) {
  try {
    console.log(
      `[${wallet.name}] Starting PNS registration from address: ${wallet.address}`
    );

    try {
      await register({
        baseDir,
        signer: wallet.signer,
        days: 29,
        provider: wallet.signer.provider as any,
      });

      console.log(`[${wallet.name}] Successfully registered PNS domain`);
      return {
        success: true,
        wallet: wallet.name,
        address: wallet.address,
      };
    } catch (error) {
      console.error(`[${wallet.name}] PNS registration failed: ${error}`);
      return {
        success: false,
        wallet: wallet.name,
        address: wallet.address,
        error,
      };
    }
  } catch (error) {
    failed({ errorMessage: `[${wallet.name}] Error: ${error}` });
    return {
      success: false,
      wallet: wallet.name,
      address: wallet.address,
      error,
    };
  }
}

/**
 * Main function to run parallel PNS registration for all wallets
 */
async function main() {
  try {
    // Load wallet configuration
    const configPath = path.resolve(__dirname, "../../config/wallets.json");
    const walletManager = loadWalletManager(configPath);

    console.log(`[BATCH MODE] Loaded ${walletManager.wallets.length} wallets.`);
    console.log(`Running all wallets in parallel (batch mode)`);

    // Execute PNS registrations for all wallets in parallel
    const startTime = Date.now();

    const results = await executeAllWalletsInParallel(
      walletManager,
      async (wallet, index) => registerPnsForWallet(wallet, index)
    );

    const endTime = Date.now();
    const executionTime = (endTime - startTime) / 1000; // in seconds

    // Print summary
    const successful = results.filter((r) => r.success).length;
    console.log(
      `\n[BATCH SUMMARY] ${successful}/${results.length} PNS registration operations were successful`
    );
    console.log(
      `[BATCH TIMING] Total execution time: ${executionTime.toFixed(2)} seconds`
    );
  } catch (error) {
    console.error(
      "[BATCH ERROR] Error running parallel PNS registrations:",
      error
    );
  }
}

main().catch(console.error);
