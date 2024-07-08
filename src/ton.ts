import { LitNodeClient } from '@lit-protocol/lit-node-client';
import { ethers } from 'ethers';

const litActionCode1 = `
(async () => {
    const LIT_PREFIX = 'lit_';

    let decryptedPrivateKey;
    try {
        decryptedPrivateKey = await Lit.Actions.decryptToSingleNode({
            accessControlConditions,
            chain: 'ethereum',
            ciphertext: null,
            dataToEncryptHash: null,
            authSig: null,
        });
    } catch (error) {
        Lit.Actions.setResponse({
            response: JSON.stringify({ error: error.message }),
        });
        return;
    }

    if (!decryptedPrivateKey) {
        Lit.Actions.setResponse({
            response: JSON.stringify({ error: "Failed to decrypt private key" }),
        });
        return;
    }

    const privateKey = decryptedPrivateKey.startsWith(LIT_PREFIX)
        ? decryptedPrivateKey.slice(LIT_PREFIX.length)
        : decryptedPrivateKey;

    const sigShare = await LitActions.signEcdsa({
        toSign: dataToSign,
        publicKey,
        sigName: sigName,
    });

    Lit.Actions.setResponse({
        response: JSON.stringify({
            privateKey: privateKey,
            signature: sigShare.signature,
        }),
    });
})();
`;

const litActionCode = `
(async () => {
    const LIT_PREFIX = 'lit_';

    let decryptedPrivateKey;
    try {
        decryptedPrivateKey = await Lit.Actions.decryptToSingleNode({
            accessControlConditions,
            chain: 1,
            authSig: null,
        });
    } catch (error) {
        Lit.Actions.setResponse({
            response: JSON.stringify({ error: error.message }),
        });
        return;
    }

    Lit.Actions.setResponse({
        response: JSON.stringify({
            privateKey: "SOME"
        }),
    });
})();
`;

export const executeLitAction = async (
    litNodeClient: LitNodeClient,
    sessionSigs: any,
    wrappedKeysPkpAddress: string,
    wrappedKeysPublicKey: string,
    customCode?: string,
    dynamicAccessControlConditions?: any[],
) => {
    const accessControlConditions = (dynamicAccessControlConditions && dynamicAccessControlConditions.length > 0) ? dynamicAccessControlConditions : [
        {
            contractAddress: '',
            standardContractType: '',
            chain: 1,
            method: '',
            parameters: [':userAddress'],
            returnValueTest: {
                comparator: '=',
                value: wrappedKeysPkpAddress,
            },
        },
    ];

    console.log("accessControlConditions",accessControlConditions);

    try {
        console.log(sessionSigs)
        const litActionResult = await litNodeClient.executeJs({
            sessionSigs,
            code: litActionCode,
            jsParams: {
                accessControlConditions
            }
        });

        console.log('LIT ACTION Result:', litActionResult);
        return litActionResult;
    } catch (error) {
        console.error('Error executing Lit Action:', error);
        throw error;
    }
};



/*
const receiverAddressDemo = 'EQCWcfUALsYW0NqgclwOGmTPErv__7VTcYqpBMVH_mVAE_y-'; // Example TON wallet address
const unsignedTransaction = {
    chain: 'ton',
    to: receiverAddressDemo,
    value: '1200000000', // 1.2 TON
    seqno: 1,
    timeout: Math.floor(Date.now() / 1000) + 60,
    bounce: true,
    payload: 'No additional data',
    sendMode: 3,
};

const litActionResult = await litNodeClient.executeJs({
    sessionSigs,
    code: litActionCode,
    jsParams: {
        accessControlConditions: accessControlConditions,
        dataToSign: ethers.utils.arrayify(
            ethers.utils.keccak256(
                ethers.utils.toUtf8Bytes(
                    JSON.stringify(unsignedTransaction),
                ),
            ),
        ),
        publicKey: wrappedKeysPublicKey,
        sigName: 'ton_transaction_sig',
    },
});
*/