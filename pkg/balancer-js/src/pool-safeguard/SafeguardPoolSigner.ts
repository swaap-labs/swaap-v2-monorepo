import { BigNumberish } from '@ethersproject/bignumber';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { SafeguardPoolSwapKind, SafeguardPoolJoinKind, SafeguardPoolExitKind } from './kinds';

const DOMAIN_NAME = 'Pool Safeguard';
const DOMAIN_VERSION = '1';

export async function signAllowlist(
  chainId: number,
  contractAddress: string,
  sender: string,
  deadline: BigNumberish,
  signer: SignerWithAddress
): Promise<string> {

  const domain = {
    name: DOMAIN_NAME,
    version: DOMAIN_VERSION,
    chainId: chainId,
    verifyingContract: contractAddress
  };

  // The named list of all type definitions
  const types = {
    AllowlistStruct: [
        { name: 'sender', type: 'address' },
        { name: 'deadline', type: 'uint256' }
    ]
  };

  // The data to sign
  const value = {
      sender: sender,
      deadline: deadline
  };

  const signature = await signer._signTypedData(domain, types, value);
  return signature;

}

export async function signSwapData(
    chainId: number,
    contractAddress: string,
    kind: SafeguardPoolSwapKind,
    tokenIn: string,
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
          { name: 'kind'     , type: 'uint8'   },
          { name: 'tokenIn'  , type: 'address' },
          { name: 'sender'   , type: 'address' },
          { name: 'recipient', type: 'address' },
          { name: 'swapData' , type: 'bytes'   },
          { name: 'deadline' , type: 'uint256' }
      ]
    };

    // The data to sign
    const value = {
        kind: kind,
        tokenIn: tokenIn,
        sender: sender,
        recipient: recipient,
        swapData: swapData,
        deadline: deadline
    };

    const signature = await signer._signTypedData(domain, types, value);
    return signature;
}