import { LitNodeClient } from "@lit-protocol/lit-node-client"
import { LitNetwork, AuthMethodScope, LIT_CHAIN_RPC_URL } from "@lit-protocol/constants"
import { ethers } from "ethers"
import { LitContracts } from "@lit-protocol/contracts-sdk"
import { LitPKPResource, LitActionResource } from "@lit-protocol/auth-helpers"
import { LitAbility } from "@lit-protocol/types"
import { ipfsHelpers } from "ipfs-helpers"
import { api } from "@lit-protocol/wrapped-keys"

const { importPrivateKey } = api

export const EOA_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

let globalState: any = {
    permittedAuthMethodAdded: false,
    litActionPermitted: false,
}

const saveToLocalStorage = () => {
    const dataToSave = {
        pkp: globalState.pkp,
        customAuthMethod: globalState.customAuthMethod,
        litActionCode: globalState.litActionCode,
        ipfsHash: globalState.ipfsHash,
        permittedAuthMethodAdded: globalState.permittedAuthMethodAdded,
        litActionPermitted: globalState.litActionPermitted,
    }
    localStorage.setItem("litProtocolData", JSON.stringify(dataToSave))
}

const loadFromLocalStorage = () => {
    const savedData = localStorage.getItem("litProtocolData")
    if (savedData) {
        globalState = { ...JSON.parse(savedData), ...globalState }
    }
}

export const connectLitNodeClient = async () => {
    const litNodeClient = new LitNodeClient({
        alertWhenUnauthorized: false,
        litNetwork: LitNetwork.Manzano,
        debug: true,
    })
    await litNodeClient.connect()
    globalState.litNodeClient = litNodeClient
}

export const connectLitContracts = async () => {
    const litContracts = new LitContracts({
        signer: new ethers.Wallet(EOA_PRIVATE_KEY, new ethers.providers.JsonRpcProvider(LIT_CHAIN_RPC_URL)),
        debug: false,
        network: LitNetwork.Manzano,
    })
    await litContracts.connect()
    globalState.litContracts = litContracts
}

export const mintPkpWithLitContracts = async () => {
    if (!globalState.pkp) {
        const eoaWalletOwnedPkp = (await globalState.litContracts.pkpNftContractUtils.write.mint()).pkp
        globalState.pkp = eoaWalletOwnedPkp
        saveToLocalStorage()
    }
}

export const createCustomAuthMethod = async () => {
    if (!globalState.customAuthMethod) {
        globalState.customAuthMethod = {
            authMethodType: 89989,
            authMethodId: "app-id-xxx:user-id-yyy",
        }
        saveToLocalStorage()
    }
}

export const addPermittedAuthMethodToPkp = async () => {
    if (!globalState.permittedAuthMethodAdded) {
        try {
            await globalState.litContracts.addPermittedAuthMethod({
                pkpTokenId: globalState.pkp.tokenId,
                authMethodType: globalState.customAuthMethod.authMethodType,
                authMethodId: globalState.customAuthMethod.authMethodId,
                authMethodScopes: [AuthMethodScope.SignAnything],
            })
            globalState.permittedAuthMethodAdded = true
            saveToLocalStorage()
        } catch (e) {
            console.error("Error adding permitted auth method to PKP:", e.message)
        }
    } else {
        console.log("Permitted auth method already added, skipping step.")
    }
}

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
        })();`
        saveToLocalStorage()
    }
}

export const convertLitActionCodeToIpfsCid = async () => {
    if (!globalState.ipfsHash) {
        globalState.ipfsHash = await ipfsHelpers.stringToCidV0(globalState.litActionCode)
        saveToLocalStorage()
    }
}

export const permitLitActionToUsePkp = async () => {
    if (!globalState.litActionPermitted) {
        try {
            await globalState.litContracts.addPermittedAction({
                ipfsId: globalState.ipfsHash,
                pkpTokenId: globalState.pkp.tokenId,
                authMethodScopes: [AuthMethodScope.SignAnything],
            })
            globalState.litActionPermitted = true
            saveToLocalStorage()
        } catch (e) {
            console.error("Error adding permitted action to PKP:", e.message)
        }
    } else {
        console.log("Lit Action already permitted, skipping step.")
    }
}

export const getSessionSigsUsingPkpPubKeyAndCustomAuth = async () => {
    const expirationTime = new Date(Date.now() + 60 * 1000)
    globalState.litActionSessionSigs = await globalState.litNodeClient.getLitActionSessionSigs({
        pkpPublicKey: globalState.pkp.publicKey,
        resourceAbilityRequests: [
            { resource: new LitPKPResource("*"), ability: LitAbility.PKPSigning },
            { resource: new LitActionResource("*"), ability: LitAbility.LitActionExecution },
        ],
        litActionCode: Buffer.from(globalState.litActionCode).toString("base64"),
        jsParams: {
            pkpPublicKey: globalState.pkp.publicKey,
            customAuthMethod: {
                authMethodType: `0x${globalState.customAuthMethod.authMethodType.toString(16)}`,
                authMethodId: `0x${Buffer.from(new TextEncoder().encode(globalState.customAuthMethod.authMethodId)).toString("hex")}`,
            },
            sigName: "custom-auth-sig",
        },
        expiration: expirationTime.toISOString(),
    })
}

export const pkpSignWithLitActionSessionSigs = async () => {
    try {
        const expirationTime = new Date(Date.now() + 60 * 1000)
        const res = await globalState.litNodeClient.pkpSign({
            pubKey: globalState.pkp.publicKey,
            sessionSigs: globalState.litActionSessionSigs,
            toSign: ethers.utils.arrayify(ethers.utils.keccak256([1, 2, 3, 4, 5])),
            expiration: expirationTime.toISOString(),
        })
        globalState.pkpSignResult = res
    } catch (e) {
        console.error("Error signing with PKP:", e.message)
    }
}

export const insertWrappedKeys = async () => {
    try {
        const wallet = ethers.Wallet.createRandom()
        const pkpAddress = await importPrivateKey({
            pkpSessionSigs: globalState.litActionSessionSigs,
            litNodeClient: globalState.litNodeClient,
            privateKey: wallet.privateKey,
            publicKey: wallet.publicKey,
            keyType: "K256",
        })
        globalState.pkpAddress = pkpAddress
    } catch (e) {
        console.error("Error in insertWrappedKeys:", e)
    }
}

const stepsConfig = [
    { step: 1, action: connectLitNodeClient, description: "Connect LitNodeClient" },
    { step: 2, action: connectLitContracts, description: "Connect LitContracts" },
    { step: 3, action: mintPkpWithLitContracts, description: "Mint a PKP" },
    { step: 4, action: createCustomAuthMethod, description: "Create a custom auth method" },
    { step: 5, action: addPermittedAuthMethodToPkp, description: "Add Permitted Auth Method" },
    { step: 6, action: createLitActionCode, description: "Create a Lit Action code" },
    { step: 7, action: convertLitActionCodeToIpfsCid, description: "Convert Lit Action to IPFS CID" },
    { step: 8, action: permitLitActionToUsePkp, description: "Permit Lit Action" },
    { step: 9, action: getSessionSigsUsingPkpPubKeyAndCustomAuth, description: "Get Session Sigs" },
    { step: 10, action: pkpSignWithLitActionSessionSigs, description: "PKP Sign" },
    { step: 11, action: insertWrappedKeys, description: "Wrapped keys" },
]

export const runAllSteps = async (useStoredData: boolean = false) => {
    if (useStoredData) {
        loadFromLocalStorage()
    } else {
        localStorage.removeItem("litProtocolData")
        globalState = {}
    }

    for (const step of stepsConfig) {
        console.log(`Executing step ${step.step}: ${step.description}`)
        await step.action()
    }
    console.log("All steps completed. Final state:", globalState)
}

// If you want to run this in a browser environment, you can use this code
if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", () => {
        const freshStartButton = document.createElement("button")
        freshStartButton.textContent = "Start Fresh"
        freshStartButton.addEventListener("click", () => runAllSteps(false))
        document.body.appendChild(freshStartButton)

        const storedDataButton = document.createElement("button")
        storedDataButton.textContent = "Start with Stored Data"
        const copiedData = `{
        "pkp": {
            "tokenId": "0xbbe1cec8e1fb45a742a4a26cbb533809f62310f3d7d73401637db7a000d748c7",
            "publicKey": "0x043a104970c8f051b8b9ecf7194fcc14bd51e7a1a08afe3c840103bf5203532e4020eaf9a2370de1f8a3909ad1f28383298cb66b4d8dcb084f822f75ef4bf1b764",
            "ethAddress": "0x5187C6a2C1ad443Ab958531d39dd5af7EB3823f1"
        }
        }`
        //parseLitData(copiedData)
        storedDataButton.addEventListener("click", () => runAllSteps(true))
        document.body.appendChild(storedDataButton)
    })
}

// Add this function to parse and set the Lit data
export const parseLitData = (inputData: string) => {
    try {
        const parsedData = JSON.parse(inputData)
        globalState = {
            ...globalState,
            pkp: parsedData.pkp,
            authUserKeys: parsedData.authUserKeys,
            authMethod: parsedData.authMethod,
            pkpSessionSigs: parsedData.pkpSessionSigs,
        }
        console.log("Lit Protocol data successfully parsed and added to global state.")
    } catch (error) {
        console.error("Failed to parse Lit Protocol data:", error)
    }
}
