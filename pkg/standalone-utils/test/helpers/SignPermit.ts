import { ethers } from "hardhat";
import { Contract } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumberish } from "@balancer-labs/v2-helpers/src/numbers";
import { defaultAbiCoder } from "ethers/lib/utils";

export async function getPermitCallData(
    name: string,
    version: string,
    chainId: number,
    signer: SignerWithAddress,
    spenderAddress: string,
    amountToApprove: BigNumberish,
    nonce: BigNumberish,
    deadline: BigNumberish,
    // signature: string,
    token: Contract
): Promise<string> {
    const { v, r, s } = await signPermit(name, version, chainId, signer, spenderAddress, amountToApprove, nonce, deadline, token);
    return defaultAbiCoder.encode(
        ["address", "address", "uint256", "uint256", "uint8", "bytes32", "bytes32"],
        [signer.address, spenderAddress, amountToApprove, deadline, v, r, s]
    );
}

export async function signPermit(
    name: string,
    version: string,
    chainId: number,
    signer: SignerWithAddress,
    spenderAddress: string,
    amountToApprove: BigNumberish,
    nonce: BigNumberish,
    deadline: BigNumberish,
    // signature: string,
    token: Contract
): Promise<{v: number, r: string, s: string}> {
    
    const domain = {
        name: name, // await token.name(),
        version: version, // await token.version(),
        chainId: chainId, // await ethers.provider.getNetwork().then((network) => network.chainId),
        verifyingContract: token.address,
    };

    const types = {
        Permit: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
            { name: "value", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
        ],
    };

    const message = {
        owner: signer.address,
        spender: spenderAddress,
        value: amountToApprove.toString(),
        nonce: nonce,
        deadline: deadline.toString(),
    };

    const signature = await signer._signTypedData(domain, types, message);

    const { v, r, s } = ethers.utils.splitSignature(signature);

    return {v , r, s};
}