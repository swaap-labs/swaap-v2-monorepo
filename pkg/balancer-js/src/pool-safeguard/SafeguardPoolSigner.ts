import { BigNumberish } from '@ethersproject/bignumber';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { SafeguardPoolSwapKind, SafeguardPoolJoinKind, SafeguardPoolExitKind } from './kinds';

const DOMAIN_NAME = 'Pool Safeguard';
const DOMAIN_VERSION = '1';

export async function signSwapData(
    chainId: number,
    contractAddress: string,
    kind: SafeguardPoolSwapKind,
    tokenIn: string,
    tokenOut: string,
    sender: string,
    recipient: string,
    deadline: BigNumberish,
    swapData: string,   
    signer: SignerWithAddress
  ): Promise<string> {
    // All properties on a domain are optional

    const domain = {
      name: DOMAIN_NAME,
      version: DOMAIN_VERSION,
      chainId: chainId,
      verifyingContract: contractAddress
    };

    // The named list of all type definitions
    const types = {
      SwapStruct: [
          { name: 'kind'    , type: 'uint8'   },
          { name: 'tokenIn' , type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'sender', type: 'address' },
          { name: 'recipient', type: 'address' },
          { name: 'deadline', type: 'uint256' },
          { name: 'swapData', type: 'bytes'   },
      ]
    };

    // The data to sign
    const value = {
        kind: kind,
        tokenIn: tokenIn,
        tokenOut: tokenOut,
        sender: sender,
        recipient: recipient,
        deadline: deadline,
        swapData: swapData,
    };

    const signature = await signer._signTypedData(domain, types, value);
    return signature;
}

export async function signJoinExactTokensData(
    chainId: number,
    contractAddress: string,
    sender: string,
    recipient: string,
    deadline: BigNumberish,
    joinData: string,
    signer: SignerWithAddress,
  ): Promise<string> {
    // All properties on a domain are optional

    const domain = {
      name: DOMAIN_NAME,
      version: DOMAIN_VERSION,
      chainId: chainId,
      verifyingContract: contractAddress
    };

    // The named list of all type definitions
    const types = {
      SwapJoinStruct: [
          { name: 'kind'    , type: 'uint8'   },
          { name: 'sender', type: 'address' },
          { name: 'recipient', type: 'address' },
          { name: 'deadline', type: 'uint256' },
          { name: 'joinData', type: 'bytes'   }
      ]
    };

    const value = {
        kind: SafeguardPoolJoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT,
        sender: sender,
        recipient: recipient,
        deadline: deadline,
        joinData: joinData,
    };

    const signature = await signer._signTypedData(domain, types, value);
    return signature;
}

export async function signExitExactTokensData(
  chainId: number,
  contractAddress: string,
  sender: string,
  recipient: string,
  deadline: BigNumberish,
  exitData: string,
  signer: SignerWithAddress,
): Promise<string> {
  // All properties on a domain are optional

  const domain = {
    name: DOMAIN_NAME,
    version: DOMAIN_VERSION,
    chainId: chainId,
    verifyingContract: contractAddress
  };

  // The named list of all type definitions
  const types = {
    SwapExitStruct: [
        { name: 'kind'    , type: 'uint8'   },
        { name: 'sender', type: 'address' },
        { name: 'recipient', type: 'address' },
        { name: 'deadline', type: 'uint256' },
        { name: 'exitData', type: 'bytes'   }
    ]
  };

  const value = {
      kind: SafeguardPoolExitKind.BPT_IN_FOR_EXACT_TOKENS_OUT,
      sender: sender,
      recipient: recipient,
      deadline: deadline,
      exitData: exitData,
  };

  const signature = await signer._signTypedData(domain, types, value);
  return signature;
}