import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

// Import the hardhat-gas-reporter plugin at the top of the file
import 'hardhat-gas-reporter';

module.exports = {
  // ... rest of your configuration
  solidity: {
    compilers: [
      {
        version: "0.7.1",
        settings: {
          optimizer: {
            enabled: true,
            runs: 9999,
          }
        }
      },
    ]
  },

  // Add the gas reporter configuration
  gasReporter: {
    currency: 'USD', // or any other currency you'd like to use
    gasPrice: 100, // price in Gwei
    // outputFile: 'gas-report.txt', // output report to a file (optional)
    enabled: true,
    showMethodSig: false,
    onlyCalledMethods: true,
    src: "../"
  },

  // Include mocha options in the hardhat configuration
//   mocha: {
//     extension: ['ts'],
//     reporter: 'hardhat-gas-reporter',
//     require: [
//       'hardhat-gas-reporter',
//       'hardhat/register',
//       '@balancer-labs/v2-common/setupTests',
//     ],
//     recursive: true,
//   },
};
