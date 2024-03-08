// Import the required modules and configuration functions
const {
  getProviderRpcUrl,
  getRouterConfig,
  getMessageState,
} = require("./config");
const { ethers, JsonRpcProvider } = require("ethers");
const routerAbi = require("../../abi/Router.json");
const offRampAbi = require("../../abi/OffRamp.json");
const onRampAbi = require("../../abi/OnRamp.json");

// Command: node src/get-status.js sourceChain destinationChain messageId
// Examples(sepolia-->Fuji):
// node src/get-status.js ethereumSepolia avalancheFuji 0xbd2f751ffab340b98575a8f46efc234e8d884db7b654c0144d7aabd72ff38595

const handleArguments = () => {
  // Check if the correct number of arguments are passed
  if (process.argv.length !== 5) {
    throw new Error("Wrong number of arguments");
  }

  // Extract the arguments from the command line
  const chain = process.argv[2];
  const targetChain = process.argv[3];
  const messageId = process.argv[4];

  // Return the arguments in an object
  return {
    chain,
    targetChain,
    messageId,
  };
};

// Main function to get the status of a message by its ID
const getStatus = async () => {
  // Parse command-line arguments
  const { chain, targetChain, messageId } = handleArguments();

  // Get the RPC URLs for both the source and destination chains
  const destinationRpcUrl = getProviderRpcUrl(targetChain);
  const sourceRpcUrl = getProviderRpcUrl(chain);

  // Initialize providers for interacting with the blockchains
  const destinationProvider = new JsonRpcProvider(destinationRpcUrl);
  const sourceProvider = new JsonRpcProvider(sourceRpcUrl);

  // Retrieve router configuration for the source and destination chains
  const sourceRouterAddress = getRouterConfig(chain).router;
  const sourceChainSelector = getRouterConfig(chain).chainSelector;
  const destinationRouterAddress = getRouterConfig(targetChain).router;
  const destinationChainSelector = getRouterConfig(targetChain).chainSelector;

  // Instantiate the router contract on the source chain
  const sourceRouterContract = new ethers.Contract(
    sourceRouterAddress,
    routerAbi,
    sourceProvider
  );

  const isChainSupported = await sourceRouterContract.isChainSupported(
    destinationChainSelector
  );

  if (!isChainSupported) {
    throw new Error(`Lane ${chain}->${targetChain} is not supported}`);
  }

  // Fetch the OnRamp contract address on the source chain
  const onRamp = await sourceRouterContract.getOnRamp(destinationChainSelector);
  const onRampContract = new ethers.Contract(onRamp, onRampAbi, sourceProvider);

  // Check if the messageId exists in the OnRamp contract
  const events = await onRampContract.queryFilter("CCIPSendRequested");
  let messageFound = false;
  for (const event of events) {
    if (
      event.args &&
      event.args.message &&
      event.args.message.messageId === messageId
    ) {
      messageFound = true;
      break;
    }
  }

  // If the messageId doesn't exist, log an error and exit
  if (!messageFound) {
    console.error(`Message ${messageId} does not exist on this lane`);
    return;
  }

  // Instantiate the router contract on the destination chain
  const destinationRouterContract = new ethers.Contract(
    destinationRouterAddress,
    routerAbi,
    destinationProvider
  );

  // Fetch the OffRamp contract addresses on the destination chain
  const offRamps = await destinationRouterContract.getOffRamps();

  // Iterate through OffRamps to find the one linked to the source chain and check message status
  for (const offRamp of offRamps) {
    if (offRamp.sourceChainSelector.toString() === sourceChainSelector) {
      const offRampContract = new ethers.Contract(
        offRamp.offRamp,
        offRampAbi,
        destinationProvider
      );
      const executionStateChangeEvent = offRampContract.filters[
        "ExecutionStateChanged"
      ](undefined, messageId, undefined, undefined);
      const events = await offRampContract.queryFilter(
        executionStateChangeEvent
      );

      // Check if an event with the specific messageId exists and log its status
      for (let event of events) {
        if (event.args && event.args.messageId === messageId) {
          const state = event.args.state;
          const status = getMessageState(state);
          console.log(`Status of message ${messageId} is ${status}`);
          return;
        }
      }
    }
  }
  // If no event found, the message has not yet been processed on the destination chain
  console.log(`Message ${messageId} is not processed yet on destination chain`);
};

// Run the getStatus function and handle any errors
getStatus().catch((e) => {
  console.error(e);
  process.exit(1);
});
