import * as dotenv from "dotenv";
import { JsonRpcProvider, Wallet } from "ethers";
import path from "path";
import fs from "fs";

// Interfaces
export interface WalletConfig {
  name: string;
  privateKey: string;
  proxy: string;
  autoStakingToken?: string; // Optional AutoStaking authentication token
}

export interface WalletInstance {
  name: string;
  address: string;
  signer: Wallet;
  proxy: string;
  autoStakingToken: string; // Optional AutoStaking authentication token
}

export interface WalletManagerSettings {
  rpcUrl: string;
  concurrentTasks?: number;
  timeoutMin?: number;
  timeoutMax?: number;
}

export interface WalletManager {
  wallets: WalletInstance[];
  settings: WalletManagerSettings;
}

/**
 * Creates a JsonRpcProvider with proxy support if needed
 */
export function createProvider(
  rpcUrl: string,
  proxyUrl: string = ""
): JsonRpcProvider {
  // Currently ethers v6 doesn't support direct proxy configuration
  // This is a workaround - in actual implementation we'd need to use
  // fetch with proxy configuration and pass it to JsonRpcProvider

  // For simplicity, we'll just return a regular provider for now
  // In production, you would need to implement a proper proxy solution
  return new JsonRpcProvider(rpcUrl);
}

/**
 * Shuffle array using Fisher-Yates algorithm
 */
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Shuffle proxy assignments among wallets and save to config file
 */
export function shuffleProxyAssignments(configPath: string): void {
  try {
    console.log("[PROXY SHUFFLE] Starting proxy shuffle process...");

    // Read current configuration
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const wallets = config.wallets;

    // Extract all non-empty proxies
    const availableProxies = wallets
      .filter(
        (wallet: WalletConfig) => wallet.proxy && wallet.proxy.trim() !== ""
      )
      .map((wallet: WalletConfig) => wallet.proxy);

    console.log(
      `[PROXY SHUFFLE] Found ${availableProxies.length} available proxies`
    );

    if (availableProxies.length === 0) {
      console.log("[PROXY SHUFFLE] No proxies available to shuffle");
      return;
    }

    // Shuffle the proxies
    const shuffledProxies = shuffleArray(availableProxies);
    console.log("[PROXY SHUFFLE] Proxies shuffled successfully");

    // Create a mapping of original proxy assignments
    const originalAssignments: Record<string, string> = {};
    wallets.forEach((wallet: WalletConfig) => {
      if (wallet.proxy && wallet.proxy.trim() !== "") {
        originalAssignments[wallet.name] = wallet.proxy;
      }
    });

    // Reassign shuffled proxies to wallets that had proxies
    let proxyIndex = 0;
    const newAssignments: Record<string, string> = {};

    wallets.forEach((wallet: WalletConfig) => {
      if (wallet.proxy && wallet.proxy.trim() !== "") {
        const newProxy = shuffledProxies[
          proxyIndex % shuffledProxies.length
        ] as string;
        wallet.proxy = newProxy;
        newAssignments[wallet.name] = newProxy;
        proxyIndex++;
      }
    });

    // Save updated configuration back to file
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");

    // Log the changes
    console.log("[PROXY SHUFFLE] Proxy assignments updated:");
    Object.keys(originalAssignments).forEach((walletName) => {
      const originalProxy = originalAssignments[walletName];
      const newProxy = newAssignments[walletName];
      const originalIP =
        originalProxy.split("@")[1]?.split(":")[0] || "unknown";
      const newIP = newProxy.split("@")[1]?.split(":")[0] || "unknown";

      if (originalProxy !== newProxy) {
        console.log(`  ${walletName}: ${originalIP} → ${newIP}`);
      } else {
        console.log(`  ${walletName}: ${originalIP} (unchanged)`);
      }
    });

    console.log(
      "[PROXY SHUFFLE] Proxy shuffle completed and saved to config file"
    );
  } catch (error) {
    console.error("[PROXY SHUFFLE] Error shuffling proxies:", error);
    throw new Error(`Failed to shuffle proxy assignments: ${error}`);
  }
}

/**
 * Load wallet configs from a JSON file and initialize the wallet manager
 */
export function loadWalletManager(configPath: string): WalletManager {
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

    const wallets: WalletInstance[] = config.wallets.map(
      (wallet: WalletConfig) => {
        const provider = createProvider(config.settings.rpcUrl, wallet.proxy);
        const signer = new Wallet(wallet.privateKey, provider);

        return {
          name: wallet.name,
          address: signer.address,
          signer,
          proxy: wallet.proxy,
          autoStakingToken: wallet.autoStakingToken, // Include autoStakingToken
        };
      }
    );

    return {
      wallets,
      settings: {
        rpcUrl: config.settings.rpcUrl,
        concurrentTasks: config.settings.concurrentTasks,
        timeoutMin: config.settings.timeoutMin,
        timeoutMax: config.settings.timeoutMax,
      },
    };
  } catch (error) {
    throw new Error(`Failed to load wallet configuration: ${error}`);
  }
}

/**
 * Load wallet configs from a JSON file with automatic proxy shuffling
 */
export function loadWalletManagerWithProxyShuffling(
  configPath: string
): WalletManager {
  // First, shuffle the proxy assignments
  shuffleProxyAssignments(configPath);

  // Then load the wallet manager with shuffled proxies
  return loadWalletManager(configPath);
}

/**
 * Execute a task for all wallets in parallel
 */
export async function executeAllWalletsInParallel<T>(
  walletManager: WalletManager,
  task: (wallet: WalletInstance, index: number) => Promise<T>
): Promise<T[]> {
  const { wallets } = walletManager;

  // Process all wallets in parallel at once
  const promises = wallets.map((wallet, index) => task(wallet, index));

  return await Promise.all(promises);
}

/**
 * Execute a task for all wallets with limited concurrency
 * @param walletManager The wallet manager containing wallets to process
 * @param task The task to execute for each wallet
 * @param concurrentTasks Maximum number of concurrent tasks (default: 5)
 * @returns Array of results
 */
export async function executeWalletsWithConcurrency<T>(
  walletManager: WalletManager,
  task: (wallet: WalletInstance, index: number) => Promise<T>,
  concurrentTasks: number = 5
): Promise<T[]> {
  const { wallets } = walletManager;
  const results: T[] = [];
  
  // Create a queue of wallets to process
  const queue = wallets.map((wallet, index) => ({ wallet, index }));
  
  console.log(`[CONCURRENCY] Processing ${wallets.length} wallets with max ${concurrentTasks} concurrent tasks`);
  
  while (queue.length > 0) {
    // Take up to concurrentTasks items from the queue
    const batch = queue.splice(0, concurrentTasks);
    
    // Process the batch in parallel
    const batchPromises = batch.map(({ wallet, index }) => task(wallet, index));
    
    console.log(`[CONCURRENCY] Processing batch of ${batchPromises.length} wallets (${wallets.length - queue.length}/${wallets.length} total)`);
    
    // Wait for all tasks in the current batch to complete
    const batchResults = await Promise.all(batchPromises);
    
    // Add the results to the final results array
    results.push(...batchResults);
  }
  
  return results;
}

/**
 * Execute a task multiple times for each wallet sequentially
 * @param walletManager The wallet manager containing wallets to process
 * @param task The task to execute for each wallet
 * @param times Number of times to execute each wallet operation
 * @returns Array of results
 */
export async function executeWalletsMultipleTimes<T>(
  walletManager: WalletManager,
  task: (wallet: WalletInstance, index: number, runCount: number) => Promise<T>,
  times: number = 1
): Promise<T[]> {
  const { wallets } = walletManager;
  const results: T[] = [];
  
  console.log(`[MULTIPLE RUNS] Running each wallet ${times} times sequentially (${wallets.length} wallets × ${times} runs = ${wallets.length * times} total operations)`);
  
  // Process wallets one by one, but run each one multiple times
  for (let index = 0; index < wallets.length; index++) {
    const wallet = wallets[index];
    console.log(`[MULTIPLE RUNS] Processing wallet ${wallet.name} (${index + 1}/${wallets.length})`);
    
    // Run the task multiple times for this wallet
    for (let runCount = 0; runCount < times; runCount++) {
      console.log(`[MULTIPLE RUNS] Wallet ${wallet.name} - Run ${runCount + 1}/${times}`);
      
      try {
        const result = await task(wallet, index, runCount);
        results.push(result);
      } catch (error) {
        console.error(`[MULTIPLE RUNS] Error with wallet ${wallet.name} on run ${runCount + 1}:`, error);
        // Push an error result
        results.push({
          success: false,
          wallet: wallet.name,
          address: wallet.address,
          error,
        } as unknown as T);
      }
    }
  }
  
  return results;
}

/**
 * Execute all wallets in parallel with each wallet running its task multiple times
 * @param walletManager The wallet manager containing wallets to process
 * @param task The task to execute for each wallet
 * @param timesPerWallet Number of times to execute each wallet operation
 * @returns Array of results
 */
export async function executeWalletsInParallelMultipleTimes<T>(
  walletManager: WalletManager,
  task: (wallet: WalletInstance, index: number, runCount: number) => Promise<T>,
  timesPerWallet: number = 1
): Promise<T[]> {
  const { wallets } = walletManager;
  
  console.log(`[PARALLEL MULTIPLE RUNS] Running all wallets in parallel, each wallet ${timesPerWallet} times (${wallets.length} wallets × ${timesPerWallet} runs = ${wallets.length * timesPerWallet} total operations)`);
  
  // Create a promise for each wallet to execute its tasks multiple times
  const walletPromises = wallets.map(async (wallet, walletIndex) => {
    const walletResults: T[] = [];
    console.log(`[PARALLEL MULTIPLE RUNS] Starting wallet ${wallet.name} tasks (${walletIndex + 1}/${wallets.length})`);
    
    // Execute the specified number of tasks for this wallet
    for (let runCount = 0; runCount < timesPerWallet; runCount++) {
      try {
        const result = await task(wallet, walletIndex, runCount);
        walletResults.push(result);
        console.log(`[PARALLEL MULTIPLE RUNS] Wallet ${wallet.name} - Completed run ${runCount + 1}/${timesPerWallet}`);
      } catch (error) {
        console.error(`[PARALLEL MULTIPLE RUNS] Error with wallet ${wallet.name} on run ${runCount + 1}:`, error);
        // Push an error result
        walletResults.push({
          success: false,
          wallet: wallet.name,
          address: wallet.address,
          error,
        } as unknown as T);
      }
    }
    
    return walletResults;
  });
  
  // Wait for all wallet processes to complete
  const nestedResults = await Promise.all(walletPromises);
  
  // Flatten the results
  return nestedResults.flat();
}
