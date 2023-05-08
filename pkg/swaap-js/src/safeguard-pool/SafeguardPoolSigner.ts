import { BigNumberish } from '@ethersproject/bignumber';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { SafeguardPoolSwapKind } from './kinds';

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
    isTokenInToken0: boolean,
    sender: string,
    recipient: string,
    swapData: string,
    quoteIndex: BigNumberish,
    deadline: BigNumberish,
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
          { name: 'kind'           , type: 'uint8'   },
          { name: 'isTokenInToken0', type: 'bool'    },
          { name: 'sender'         , type: 'address' },
          { name: 'recipient'      , type: 'address' },
          { name: 'swapData'       , type: 'bytes'   },
          { name: 'quoteIndex'     , type: 'uint256' },
          { name: 'deadline'       , type: 'uint256' }
      ]
    };

    // The data to sign
    const value = {
        kind: kind,
        isTokenInToken0: isTokenInToken0,
        sender: sender,
        recipient: recipient,
        swapData: swapData,
        quoteIndex: quoteIndex,
        deadline: deadline
    };

    const signature = await signer._signTypedData(domain, types, value);
    return signature;
}