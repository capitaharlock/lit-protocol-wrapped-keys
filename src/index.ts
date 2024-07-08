import { LitNodeClient } from "@lit-protocol/lit-node-client"
import { LitNetwork, AuthMethodScope, LIT_CHAIN_RPC_URL } from "@lit-protocol/constants"
import { ethers } from "ethers"
import { LitContracts } from "@lit-protocol/contracts-sdk"
import { LitPKPResource, LitActionResource } from "@lit-protocol/auth-helpers"
import { LitAbility } from "@lit-protocol/types"
import { ipfsHelpers } from "ipfs-helpers"
import { api } from "@lit-protocol/wrapped-keys"
import { signTransactionWithEncryptedKey } from '@lit-protocol/wrapped-keys/src/lib/api';
import { EthereumLitTransaction } from '@lit-protocol/wrapped-keys/src/lib/types';
import {executeLitAction} from "./ton"
import {saveToLocalStorage, loadFromLocalStorage} from "./storage"
import { globalState } from './types/globalState';

const { importPrivateKey } = api;

export const EOA_PRIVATE_KEY =
    '7b5b0ad7b6cf651559437c655f34c224e4d72a1394a6c52b6653b7cdbaa92190'; // secret :)

let globalState: any = {
    permittedAuthMethodAdded: false,
    litActionPermitted: false,
    wrappedKeysPkpAddress: null,
    wrappedKeysPublicKey: null,
    wrappedKeysAddress: null,
};

export const connectLitNodeClientToCayenne = async () => {
    const litNodeClient = new LitNodeClient({
        alertWhenUnauthorized: false,
        litNetwork: LitNetwork.Cayenne,
        debug: true,
    });
    await litNodeClient.connect();
    globalState.litNodeClient = litNodeClient;
};

export const connectLitContractsToCayenne = async () => {
    const litContracts = new LitContracts({
        signer: new ethers.Wallet(
            EOA_PRIVATE_KEY,
            new ethers.providers.JsonRpcProvider(
                'https://chain-rpc.litprotocol.com/http',
            ),
        ),
        debug: false,
        network: LitNetwork.Cayenne,
    });
    await litContracts.connect();
    globalState.litContracts = litContracts;
};

export const mintPkpWithLitContracts = async () => {
    if (!globalState.pkp) {
        const eoaWalletOwnedPkp = (
            await globalState.litContracts.pkpNftContractUtils.write.mint()
        ).pkp;
        globalState.pkp = eoaWalletOwnedPkp;
        console.log("save PKP: ",eoaWalletOwnedPkp )
        saveToLocalStorage(globalState);
    }
};

export const createCustomAuthMethod = async () => {
    if (!globalState.customAuthMethod) {
        globalState.customAuthMethod = {
            authMethodType: 89989,
            authMethodId: 'app-id-xxx:user-id-yyy',
        };
        saveToLocalStorage(globalState);
    }
};

export const addPermittedAuthMethodToPkp = async () => {
    if (!globalState.permittedAuthMethodAdded) {
        try {
            await globalState.litContracts.addPermittedAuthMethod({
                pkpTokenId: globalState.pkp.tokenId,
                authMethodType: globalState.customAuthMethod.authMethodType,
                authMethodId: globalState.customAuthMethod.authMethodId,
                authMethodScopes: [AuthMethodScope.SignAnything],
            });
            globalState.permittedAuthMethodAdded = true;
            saveToLocalStorage(globalState);
        } catch (e) {
            console.error(
                'Error adding permitted auth method to PKP:',
                e.message,
            );
        }
    } else {
        console.log('Permitted auth method already added, skipping step.');
    }
};

export const createLitActionCode = async () => {
    if (!globalState.litActionCode) {
        globalState.litActionCode = `(async () => {
            const tokenId = await Lit.Actions.pubkeyToTokenId({ publicKey: pkpPublicKey });
            const permittedAuthMethods = await Lit.Actions.getPermittedAuthMethods({ tokenId });
            const isPermitted = permittedAuthMethods.some((permittedAuthMethod) => {
                if (permittedAuthMethod["auth_method_type"] === "0x15f85" && 
                    permittedAuthMethod["id"] === customAuthMethod.authMethodId) {
                return true;
                }
                return false;
            });
            LitActions.setResponse({ response: isPermitted ? "true" : "false" });
        })();`;
        saveToLocalStorage(globalState);
    }
};

export const convertLitActionCodeToIpfsCid = async () => {
    if (!globalState.ipfsHash) {
        globalState.ipfsHash = await ipfsHelpers.stringToCidV0(
            globalState.litActionCode,
        );
        saveToLocalStorage(globalState);
    }
};

export const permitLitActionToUsePkp = async () => {
    if (!globalState.litActionPermitted) {
        try {
            await globalState.litContracts.addPermittedAction({
                ipfsId: globalState.ipfsHash,
                pkpTokenId: globalState.pkp.tokenId,
                authMethodScopes: [AuthMethodScope.SignAnything],
            });
            globalState.litActionPermitted = true;
            saveToLocalStorage(globalState);
        } catch (e) {
            console.error('Error adding permitted action to PKP:', e.message);
        }
    } else {
        console.log('Lit Action already permitted, skipping step.');
    }
};

export const getSessionSigsUsingPkpPubKeyAndCustomAuth = async () => {
    globalState.sessionSigs =
        await globalState.litNodeClient.getLitActionSessionSigs({
            pkpPublicKey: globalState.pkp.publicKey,
            expiration: new Date(Date.now() + 1000 * 60 * 10).toISOString(), // 10 minutes
            resourceAbilityRequests: [
                {
                    resource: new LitPKPResource('*'),
                    ability: LitAbility.PKPSigning,
                },
                {
                    resource: new LitActionResource('*'),
                    ability: LitAbility.LitActionExecution,
                },
            ],
            litActionCode: Buffer.from(globalState.litActionCode).toString(
                'base64',
            ),
            jsParams: {
                pkpPublicKey: globalState.pkp.publicKey,
                customAuthMethod: {
                    authMethodType: `0x${globalState.customAuthMethod.authMethodType.toString(16)}`,
                    authMethodId: `0x${Buffer.from(new TextEncoder().encode(globalState.customAuthMethod.authMethodId)).toString('hex')}`,
                },
                sigName: 'custom-auth-sig',
            },
        });
};

export const pkpSignWithLitActionSessionSigs = async () => {
    try {
        const res = await globalState.litNodeClient.pkpSign({
            pubKey: globalState.pkp.publicKey,
            sessionSigs: globalState.sessionSigs,
            toSign: ethers.utils.arrayify(
                ethers.utils.keccak256([1, 2, 3, 4, 5]),
            ),
        });
        globalState.pkpSignResult = res;
    } catch (e) {
        console.error('Error signing with PKP:', e.message);
    }
};

export const insertWrappedKeys = async () => {
    if (!globalState.wrappedKeysPkpAddress) {
    try {
        const wallet = ethers.Wallet.createRandom();
        const wrappedKeysPkpAddress = await importPrivateKey({
            pkpSessionSigs: globalState.sessionSigs,
            litNodeClient: globalState.litNodeClient,
            privateKey: wallet.privateKey,
            publicKey: wallet.publicKey,
            keyType: 'K256',
        });
        globalState.wrappedKeysPkpAddress = wrappedKeysPkpAddress;
        globalState.wrappedKeysPublicKey = wallet.publicKey;
        globalState.wrappedKeysAddress = wallet.address;
        saveToLocalStorage(globalState);
    } catch (e) {
        console.error('Error in insertWrappedKeys:', e);
    }
}
};

export const signTxnWithWrapped = async () => {
    return;
    const unsignedTransaction: EthereumLitTransaction = {
        chain: 'chronicleTestnet',
        toAddress: '0x69c7C120Ad9B545AD744D21616b68d0A95A97D45',
        value: '0.0000000000001', // Make sure the funds are sufficient (in ETH)
        chainId: 175177,
        //gasPrice: '20000000000', // Does not need to be set, we will estimate it within the Lit Action
        gasLimit: 21000, // Do not have to provide this either, but sometimes can cause errors if you do not
    };
    try {
        const test = await signTransactionWithEncryptedKey({
            litNodeClient: globalState.litNodeClient,
            network: 'evm',
            pkpSessionSigs: globalState.sessionSigs,
            broadcast: true, // true requires wrapped key to have funds
            unsignedTransaction: unsignedTransaction,
        });
        globalState.txnHash = test;
        console.log('Transaction Hash: ', globalState.txnHash);
    } catch (e) {
        console.error('Error in signMessageWithWrapped:', e);
    }
};

export const signTonTxnWithWrapped = async () => {
    console.log("signTonTxnWithWrapped-->",globalState)
    const dynamicAccessControlConditions: [] = [];
    await executeLitAction(    
        globalState.litNodeClient,
        globalState.sessionSigs,
        globalState.wrappedKeysPkpAddress,
        globalState.wrappedKeysPublicKey,
        globalState.customCode,
        dynamicAccessControlConditions,
    );
}

const stepsConfig = [
    {
        step: 1,
        action: connectLitNodeClientToCayenne,
        description: 'Connect LitNodeClient',
    },
    {
        step: 2,
        action: connectLitContractsToCayenne,
        description: 'Connect LitContracts',
    },
    { step: 3, action: mintPkpWithLitContracts, description: 'Mint a PKP' },
    {
        step: 4,
        action: createCustomAuthMethod,
        description: 'Create a custom auth method',
    },
    {
        step: 5,
        action: addPermittedAuthMethodToPkp,
        description: 'Add Permitted Auth Method',
    },
    {
        step: 6,
        action: createLitActionCode,
        description: 'Create a Lit Action code',
    },
    {
        step: 7,
        action: convertLitActionCodeToIpfsCid,
        description: 'Convert Lit Action to IPFS CID',
    },
    {
        step: 8,
        action: permitLitActionToUsePkp,
        description: 'Permit Lit Action',
    },
    {
        step: 9,
        action: getSessionSigsUsingPkpPubKeyAndCustomAuth,
        description: 'Get Session Sigs',
    },
    {
        step: 10,
        action: pkpSignWithLitActionSessionSigs,
        description: 'PKP Sign',
    },
    { step: 11, action: insertWrappedKeys, description: 'Wrapped keys' },
    {
        step: 12,
        action: signTxnWithWrapped,
        description: 'Github response from Lit staff | Transaction signed with the wrapped key',
    },
    {
        step: 13,
        action: signTonTxnWithWrapped,
        description: 'TON Lit Action trying to use the Wrapped private key (currently using an ETH one for test purposes)',
    },
];

export const runAllSteps = async (useStoredData: boolean = false) => {
    if (useStoredData) {
        loadFromLocalStorage(globalState);
    } else {
        localStorage.removeItem('litProtocolData');
        globalState = {};
    }

    for (const step of stepsConfig) {
        console.log(`Executing step ${step.step}: ${step.description}`);
        await step.action();
    }
    console.log('All steps completed. Final state:', globalState);
};

const updateGlobalStateOutput = () => {
    const outputElement = document.createElement('div');
    outputElement.id = 'globalStateOutput';

    outputElement.innerHTML = `
        <div style="padding:20px; border:1px solid #000; margin-bottom:20px">
        <h2>Global State</h2>
        <p><strong>PKP:</strong> ${JSON.stringify(globalState.pkp, null, 2)}</p>
        <p><strong>Custom Auth Method:</strong> ${JSON.stringify(globalState.customAuthMethod, null, 2)}</p>
        <p><strong>IPFS Hash:</strong> ${globalState.ipfsHash}</p>
        <p><strong>Permitted Auth Method Added:</strong> ${globalState.permittedAuthMethodAdded}</p>
        <p><strong>Lit Action Permitted:</strong> ${globalState.litActionPermitted}</p>
        <p><strong>Wrapped Keys PKP Address:</strong> ${globalState.wrappedKeysPkpAddress}</p>
        <p><strong>Wrapped Keys Public Key:</strong> ${globalState.wrappedKeysPublicKey}</p>
        <p><strong>Wrapped Keys Address:</strong> ${globalState.wrappedKeysAddress}</p>
        </div>
    `;

    // Remove the previous output if it exists
    const existingOutput = document.getElementById('globalStateOutput');
    if (existingOutput) {
        document.body.removeChild(existingOutput);
    }

    document.body.appendChild(outputElement);
};

// If you want to run this in a browser environment, you can use this code
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {

                // Load and display stored data on page load
                loadFromLocalStorage(globalState);
                updateGlobalStateOutput();

        const freshStartButton = document.createElement('button');
        freshStartButton.textContent = 'Start Fresh';
        freshStartButton.addEventListener('click', () => runAllSteps(false));
        document.body.appendChild(freshStartButton);

        const storedDataButton = document.createElement('button');
        storedDataButton.textContent = 'Start with Stored Data';
        storedDataButton.addEventListener('click', () => runAllSteps(true));
        document.body.appendChild(storedDataButton);
    });
}