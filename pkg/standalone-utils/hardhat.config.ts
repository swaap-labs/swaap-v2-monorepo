// Import the hardhat-gas-reporter plugin at the top of the file
import 'hardhat-gas-reporter';
import 'hardhat-contract-sizer';
import "@nomicfoundation/hardhat-toolbox";
import 'hardhat-ignore-warnings';

import * as dotenv from "dotenv";
dotenv.config({ path: __dirname+'/.env' });

module.exports = {

  solidity: {
    compilers: [
      {
        version: "0.8.18",
        settings: {
          optimizer: {
            enabled: true,
            runs: 99999,
          }
        }
      },
    ]
  },

  contractSizer: {
    alphaSort: true,
    disambiguatePaths: false,
    runOnCompile: true,
    strict: true,
  },

  networks: {
    hardhat: {
      allowUnlimitedContractSize: true,
      forking: {
        url: process.env.MAINNET_RPC_URL?? "https://eth.llamarpc.com",
        blockNumber: 17635689
      }
    },
    // polygon: {
    //   url: `${process.env.POLYGON_RPC_URL}`,
    //   accounts: [`${process.env.PRIVATE_KEY}`],
    //   blockConfirmations: 6,
    // },
  },

  warnings: {
    // Ignore code-size in test files: mocks may make contracts not deployable on real networks, but we don't care about
    // that.
    'contracts/test/*': {
      'code-size': 'off',
    },
    // Turn off function sha
    '*': {
      // Turns off variable is shadowed in inline assembly instruction
      'code-size': 'warn',
      'shadowing-opcode': 'off',
    }
  },

};