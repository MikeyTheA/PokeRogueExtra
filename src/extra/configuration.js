export const configuration = localStorage.getItem('extra') && JSON.parse(localStorage.getItem('extra')) || {
    windows: {}
}

export const save = () => {
    localStorage.setItem('extra', JSON.stringify(configuration))
}

export const set = (key, value) => {
    const keys = key.split("/")
    let configRef = configuration;

    for (let i = 0; i < keys.length - 1; i++) {
        const currentKey = keys[i];
        if (!configRef[currentKey]) {
            configRef[currentKey] = {};
        }
        configRef = configRef[currentKey];
    }
    configRef[keys.pop()] = value;

    save()
}

export const get = (key) => {
    const keys = key.split("/");
    let configRef = configuration;

    for (let i = 0; i < keys.length; i++) {
        const currentKey = keys[i];
        if (!configRef[currentKey]) {
            return undefined; // Return undefined if any intermediate key is missing
        }
        configRef = configRef[currentKey];
    }

    return configRef;
}

save()