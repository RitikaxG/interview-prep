import express from "express";
import { createClient } from "redis";
import { prisma } from "./db";

const app = express();
const client = createClient();

app.use(express.json());

const initializeRedis = async (): Promise<void> => {
    client.on("error",err => console.log(`Redis connection error`,err));
    await client.connect();
}

initializeRedis();

const SERVICE_NAME = process.env.SERVICE_NAME || "startup_api_v1";
const APP_VERSION = process.env.APP_VERSION || "dev";
const NODE_ENV = process.env.NODE_ENV || "development";
const GIT_SHA = process.env.GIT_SHA || "local";
const BUILD_TIME = process.env.BUILD_TIME || "unknown";

type CheckResult = {
    status : "ok" | "error",
    latencyMs? : number,
    message? : string
}

const nowISO = () => {
    return new Date().toISOString();
}

const checkRequiredConfigs = (): CheckResult => {
    const requiredConfigs = ["DATABASE_URL","REDIS_URL"];

    const missing = requiredConfigs.filter((key) => !process.env[key]);
    if(missing.length > 0){
        return {
            status :"error",
            message : `Required configs missing ${missing.join(",")}`,
        }
    }

    return {
        status : "ok"
    }
}

const checkService = async (fn : () => Promise<void>) : Promise<CheckResult> => {
    const start = Date.now();

    try{
        await fn();
        return {
            status : "ok",
            latencyMs : Date.now() - start,
        }
    }catch(error){
        return {
            status : "error",
            latencyMs : Date.now() - start,
            message : error instanceof Error ? error.message : "Unknown error"
        }
    }
}

const pingDB = async () : Promise<void> => {
    await prisma.$queryRaw`SELECT 1`;
}

const pingRedis = async() : Promise<void> => {
    await client.set("key","value");
}

app.get("/health",(_req,res) => {
    return res.status(200).json({
        status : "ok",
        service : SERVICE_NAME,
        timestamp : nowISO()
    })
});


app.get("/ready",async (_req,res) => {
    const checks = {
        configs : checkRequiredConfigs(),
        database : await checkService(pingDB),
        redis : await checkService(pingRedis)
    };

    const isReady = Object.values(checks).every((check) => check.status === "ok");

    return res.status(isReady ? 200 : 503).json({
        status : isReady ? "ready" : "not_ready",
        service : SERVICE_NAME,
        checks,
        timestamp : nowISO()
    });
})

app.get("/version",(_req,res) => {
    return res.status(200).json({
        service : SERVICE_NAME,
        version : APP_VERSION,
        gitSha : GIT_SHA,
        buildTime : BUILD_TIME,
        nodeEnv : NODE_ENV
    })
});

app.listen(3000,()=> {
    console.log("Server is running on port 3000")
});