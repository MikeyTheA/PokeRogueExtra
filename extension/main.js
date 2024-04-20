const indexURL = chrome.runtime.getURL('index.js')

let isChromium = !!window.chrome;
if (isChromium) {
    const observer = new MutationObserver(async (mutations, obs) => {
        for (const mutation of mutations) {
            mutation.addedNodes.forEach(async node => {
                if (node.tagName === 'SCRIPT' && node.src && node.src.includes('assets/index')) {
                    node.remove()
                    obs.disconnect()
                    
                    const script = document.createElement('script');
                    script.textContent = await (await fetch(indexURL)).text();
                    document.documentElement.appendChild(script);
                }
            })
        }
    })

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true
    });
} else { //firefox & webkit
    document.addEventListener('beforescriptexecute', async e => {
        const target = e.target;
        if (target.src.startsWith("https://pokerogue.net/assets/index")) {
            e.preventDefault();
            const script = document.createElement('script');
            script.textContent = await (await fetch(indexURL)).text();
            document.documentElement.appendChild(script);
        }
    });
}