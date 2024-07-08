
export const saveToLocalStorage = (globalState) => {
    const dataToSave = {
        pkp: globalState.pkp,
        wrappedKeysPkpAddress: globalState.wrappedKeysPkpAddress,
        wrappedKeysPublicKey: globalState.wrappedKeysPublicKey,
        wrappedKeysAddress: globalState.wrappedKeysAddress,
        customAuthMethod: globalState.customAuthMethod,
        litActionCode: globalState.litActionCode,
        ipfsHash: globalState.ipfsHash,
        permittedAuthMethodAdded: globalState.permittedAuthMethodAdded,
        litActionPermitted: globalState.litActionPermitted,
    };
    localStorage.setItem('litProtocolData', JSON.stringify(dataToSave));
};

export const loadFromLocalStorage = (globalState) => {
    const savedData = localStorage.getItem('litProtocolData');
    console.log("loadFromLocalStorage", savedData);
    if (savedData) {
        try {
            const parsedData = JSON.parse(savedData);
            console.log("parsedData", parsedData);
            if (parsedData && typeof parsedData === 'object') {
                Object.assign(globalState, parsedData);
            }
        } catch (error) {
            console.error('Error parsing saved data from local storage:', error);
        }
    }
};