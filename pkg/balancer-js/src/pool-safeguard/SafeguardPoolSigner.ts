import { BigNumberish } from '@ethersproject/bignumber';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { SafeguardPoolSwapKind, SafeguardPoolJoinKind, SafeguardPoolExitKind } from './kinds';

const DOMAIN_NAME = 'Pool Safeguard';
const DOMAIN_VERSION = '1.0.0';

export async function signSwapData(
    contractAddress: string,
    deadline: BigNumberish,
    swapData: string,   
    signer: SignerWithAddress,
    chainId: number
  ): Promise<string> {
    // All properties on a domain are optional
    // const { chainId } = await ethers.provider.getNetwork();

    const domain = {
      name: DOMAIN_NAME,
      version: DOMAIN_VERSION,
      chainId: chainId,
      verifyingContract: contractAddress
    };

    // The named list of all type definitions
    const types = {
      SwapStruct: [
          { name: 'deadline', type: 'uint256' },
          { name: 'swapData', type: 'bytes' },
      ]
    };

    // The data to sign
    const value = {
        deadline: deadline,
        swapData: swapData,
    };

    const signature = await signer._signTypedData(domain, types, value);
    return signature;
}

export async function signJoinExactTokensData(
    contractAddress: string,
    poolId: string,
    receiver: string,
    deadline: BigNumberish,
    joinData: string,
    signer: SignerWithAddress,
    chainId: number
  ): Promise<string> {
    // All properties on a domain are optional
    // const { chainId } = await ethers.provider.getNetwork();

    const domain = {
      name: DOMAIN_NAME,
      version: DOMAIN_VERSION,
      chainId: chainId,
      verifyingContract: contractAddress
    };

    // The named list of all type definitions
    const types = {
      JoinExactTokensStruct: [
          { name: 'kind'    , type: 'uint8'   }, // TODO check enum type
          { name: 'poolId'  , type: 'bytes32' },
          { name: 'receiver', type: 'address' },
          { name: 'deadline', type: 'uint256' },
          { name: 'joinData', type: 'bytes'   },
      ]
    };

    // The data to sign
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