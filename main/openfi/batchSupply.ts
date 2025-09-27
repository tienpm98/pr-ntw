import path from "path";
import { failed } from "@scripts/utils/console";
import {
  executeAllWalletsInParallel,
  loadWalletManager,
  WalletInstance,
} from "@scripts/utils/batchWallet";
import { openFiAssets } from "@scripts/lib/data";
import { supply } from "@scripts/pharosNetwork/lendBorrowOpenfi/supply";
import { randomAmount } from "@scripts/utils/amount";
import { sleep } from "@scripts/utils/time";
import fs from "fs";

/**
 * Generate a random delay between 20-40 seconds
 */
function randomDelay(): number {
  return Math.floor(
    randomAmount({
      min: 20000,
      max: 40000,
    })
  );
}

/**
 * Perform OpenFi supply operations for a single wallet in parallel
 */
async function supplyForWallet(
  wallet: WalletInstance,
  index: number,
  amountInPercent: number = 50
) {
  try {
    console.log(
      `[${wallet.name}] Starting OpenFi supply from address: ${wallet.address}`
    );

    // Apply random delay before starting action
    const delayMs = randomDelay();
    console.log(
      `[${wallet.name}] Waiting ${(delayMs / 1000).toFixed(
        1
      )}s before starting...`
    );
    await sleep(delayMs);

    // Randomly select an asset to supply
    const indexAsset = Math.floor(
      randomAmount({
        min: 0,
        max: Number(openFiAssets.length - 1),
      })
    );
    const tokenAddress = openFiAssets[indexAsset].address;
    const tokenName = openFiAssets[indexAsset].name;

    console.log(`[${wallet.name}] Supplying ${tokenName} to OpenFi...`);
    await supply({
      signer: wallet.signer,
      tokenAddress,
      amountInPercent,
      provider: wallet.signer.provider as any,
    });

    console.log(`[${wallet.name}] OpenFi supply completed successfully`);
    return {
      success: true,
      wallet: wallet.name,
      address: wallet.address,
      token: tokenName,
    };
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
 * Main function to run parallel OpenFi supply for all wallets
 */
async function main() {
  try {
    // Load wallet configuration
    const configPath = path.resolve(__dirname, "../../config/wallets.json");
    const walletManager = loadWalletManager(configPath);
    const configData = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const concurrentTasks = configData.settings.concurrentTasks || 1;

    console.log(`[BATCH MODE] Loaded ${walletManager.wallets.length} wallets.`);
    console.log(
      `[BATCH MODE] Will run supply ${concurrentTasks} times as specified in config`
    );
    console.log(`Running all wallets in parallel (batch mode)`);

    // Execute supply operations for all wallets in parallel
    const startTime = Date.now();
    let totalSuccessful = 0;
    let totalOperations = 0;
    let allTokenStats: Record<string, number> = {};

    // Run supply operations concurrentTasks times (91 times as per config)
    for (let i = 0; i < concurrentTasks; i++) {
      console.log(`\n[BATCH ROUND] Starting round ${i + 1}/${concurrentTasks}`);

      const results = await executeAllWalletsInParallel(
        walletManager,
        async (wallet, index) => supplyForWallet(wallet, index, 50) // Use 50% for supply
      );

      const successful = results.filter((r) => r.success).length;
      totalSuccessful += successful;
      totalOperations += results.length;

      console.log(
        `[BATCH ROUND ${i + 1}] ${successful}/${
          results.length
        } OpenFi supply operations were successful`
      );

      // Update token statistics
      results
        .filter((r) => r.success && r.token)
        .forEach((r) => {
          const token = r.token as string;
          allTokenStats[token] = (allTokenStats[token] || 0) + 1;
        });

      // Add a delay between rounds to avoid rate limiting
      if (i < concurrentTasks - 1) {
        const roundDelay = randomDelay();
        console.log(
          `[BATCH ROUND] Waiting ${(roundDelay / 1000).toFixed(
            1
          )}s before next round...`
        );
        await sleep(roundDelay);
      }
    }

    const endTime = Date.now();
    const executionTime = (endTime - startTime) / 1000; // in seconds

    // Print summary
    console.log(
      `\n[BATCH SUMMARY] ${totalSuccessful}/${totalOperations} OpenFi supply operations were successful across ${concurrentTasks} rounds`
    );
    console.log(
      `[BATCH TIMING] Total execution time: ${executionTime.toFixed(2)} seconds`
    );

    // Print token statistics
    console.log("\nTokens supplied:");
    Object.entries(allTokenStats).forEach(([token, count]) => {
      console.log(`- ${token}: ${count} wallets`);
    });
  } catch (error) {
    console.error("[BATCH ERROR] Error running parallel OpenFi supply:", error);
  }
}

main().catch(console.error);
