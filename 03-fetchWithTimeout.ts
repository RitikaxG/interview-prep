import axios from "axios";

type FetchResult = {
    url : string;
    ok : boolean;
    status? : number;
    durationMs : number;
    error? : 
    | "HTTP_ERROR"
    | "NETWORK_ERROR"
    | "CANCELLED"
    | "TIMEOUT"
};

const fetchWithTimeout = async (
    url : string,
    timeoutMs : number,
    signal? : AbortSignal
): Promise<FetchResult> => {
    const startedAt = Date.now();
    try{
        const response = await axios.get(url, {
            timeout : timeoutMs,
            signal,

            // whether the HTTP response should resolve or reject based on HTTP status code
            validateStatus : () => true
        });

        const durationMs = Date.now() - startedAt;

        if(response.status < 200 || response.status >= 300){
            return {
                url,
                ok : false,
                status : response.status,
                durationMs,
                error : "HTTP_ERROR"
            }
        }

        return {
            url,
            ok : true,
            status : response.status,
            durationMs
        }
    } 
    catch(error){
        const durationMs = Date.now() - startedAt;

        if(axios.isAxiosError(error)){
            if(error.code === "ERR_CANCELED"){
                return {
                    url,
                    ok : false,
                    durationMs,
                    error : "CANCELLED"
                }
            }

            if( 
                error.code === "ECONNABORTED" || 
                error.code === "ETIMEDOUT"
            ){
                return {
                    url,
                    ok : false,
                    durationMs,
                    error : "TIMEOUT"
                }
            }
        }
        return {
            url,
            ok : false,
            durationMs,
            error : "NETWORK_ERROR"
        }
    }
}

const check10Urls = async (
    urls : string[],
    timeoutMs: number,
    signal : AbortSignal
) => {
    if(urls.length !== 10){
        throw new Error("There should be exactly 10 urls");
    }

    if(timeoutMs < 0){
        throw new Error("timeoutMs must be greater than 0")
    }

    let allResults : FetchResult[] = [];

    for(let index = 0; index < urls.length ; index += 3){
        const currentGroup = urls.slice(index, index + 3);

        console.log("Starting Group",currentGroup);

        const groupResult = await Promise.all(
            currentGroup.map((url) => fetchWithTimeout(url,timeoutMs,signal)));

        allResults.push(...groupResult);
    }
    return allResults;
}

const urls = [
    "https://www.ritikaxg.co.in/",
    "https://github.com/RitikaxG",
    "https://x.com/RitikaxG",
    "https://www.google.com/",
    "https://www.youtube.com/",
    "https://harkirat.classx.co.in/",
    "https://www.instagram.com/",
    "https://www.linkedin.com/",
    "https://www.notion.com/",
    "https://chatgpt.com/"
]
const controller = new AbortController;
const results = await check10Urls(urls,3000,controller.signal);
controller.abort();
console.log(results);