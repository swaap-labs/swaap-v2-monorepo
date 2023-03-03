import { BigNumberish } from '@ethersproject/bignumber';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { SafeguardPoolSwapKind, SafeguardPoolJoinKind, SafeguardPoolExitKind } from './kinds';

const DOMAIN_NAME = 'Pool Safeguard';
const DOMAIN_VERSION = '1';

export async function signSwapData(
    chainId: number,
    contractAddress: string,
    kind: SafeguardPoolSwapKind,
    poolId: string,
    tokenIn: string,
    tokenOut: string,
    amount: BigNumberish,
    receiver: string,
    deadline: BigNumberish,
    swapData: string,   
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
      SwapStruct: [
          { name: 'kind'    , type: 'uint8'   },
          { name: 'poolId'  , type: 'bytes32' },
          { name: 'tokenIn' , type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'amount'  , type: 'uint256' },
          { name: 'receiver', type: 'address' },
          { name: 'deadline', type: 'uint256' },
          { name: 'swapData', type: 'bytes'   },
      ]
    };

    // The data to sign
    const value = {
        kind: kind,
        poolId: poolId,
        tokenIn: tokenIn,
        tokenOut: tokenOut,
        amount: amount,
        receiver: receiver,
        deadline: deadline,
        swapData: swapData,
    };

    const signature = await signer._signTypedData(domain, types, value);
    return signature;
}

export async function signJoinExactTokensData(
    chainId: number,
    contractAddress: string,
    poolId: string,
    receiver: string,
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
      JoinExactTokensStruct: [
          { name: 'kind'    , type: 'uint8'   }, // TODO check e  num type
          { name: 'poolId'  , type: 'bytes32' },
          { name: 'receiver', type: 'address' },
          { name: 'deadline', type: 'uint256' },
          { name: 'joinData', type: 'bytes'   }
      ]
    };

    const value = {
        kind: SafeguardPoolJoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT,
        poolId: poolId,
        receiver: receiver,
        deadline: deadline,
        joinData: joinData,
    };

    const signature = await signer._signTypedData(domain, types, value);
    return signature;
}