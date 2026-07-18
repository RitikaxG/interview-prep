import axios from "axios";
import { error } from "node:console";
import { createHash, randomUUID } from "node:crypto";

/*
SERVER SIDE OPERATION
*/
type WorkStatus = 
    | "QUEUED"
    | "PROCESSING"
    | "COMPLETED"
    | "FAILED_RETRYABLE";

type Work = {
    id : string,
    status : WorkStatus,
    contentHash : string,
}

type Job = {
    id : string,
    userId : string,
    workKey : string
}

type IdempotencyRecord = {
    fingerprint : string,
    jobId : string
}

const jobs = new Map<string,Job>();

const workByHash = new Map<string,Work>();

const idempotencyRecords = new Map<string, IdempotencyRecord>();

const createContentHash = (
    content : string
) : string => {
    return createHash("sha256").update(content).digest("hex");
}

const createWorkKey = (
    userId : string,
    contentHash : string
) : string => {
    return `${userId}:${contentHash}`
}

const getOrCreateWork = (
    userId : string,
    contentHash : string
) : Work => {
    const workKey = createWorkKey(userId,contentHash)
    const existingWork = workByHash.get(workKey);

    if(existingWork){
        return existingWork
    }

    const newWork : Work = {
        id : randomUUID(),
        status : "QUEUED",
        contentHash
    }

    workByHash.set(workKey,newWork);
    return newWork;
}

const createJob = (
    userId : string,
    idempotencyKey : string,
    content : string,
) => {
    if(!idempotencyKey){
        return {
            status : 400,
            body : {
                error : "IDEMPOTENCY_KEY_REQUIRED"
            }
        }
    }

    const contentHash = createContentHash(content);
    const fingerprint = contentHash;
    const operationKey = `${userId}:create-job:${idempotencyKey}`;


    const previous = idempotencyRecords.get(operationKey);
    if(previous){
        // same key different content
        if(previous.fingerprint !== fingerprint){
            return {
                status : 409,
                body : {
                    error : "IDEMPOTENCY_KEY_REUSED"
                }
            }
        }

        // For same key same content
        // Get job
        const originalJob = jobs.get(previous.jobId);
        if(!originalJob){
            return {
                status : 500,
                body : {
                    error : "ORIGINAL_JOB_REQUIRED"
                }
            }
        }
        // Get work
        const workKey = originalJob.workKey;
        const work = workByHash.get(workKey);

        if(!work){
            return {
                status : 500,
                body : {
                    error : "WORK_REQUIRED"
                }
            }
        }

        return {
            jobId : previous.jobId,
            workId : work.id,
            workStatus : work.status,
            idempotencyReplay : true
        }
    }

    // If new operation

    // new work
    const work = getOrCreateWork(userId, contentHash);
    const workKey = createWorkKey(userId, contentHash);

    // new job
    const newJob : Job = {
        id : randomUUID(),
        userId,
        workKey
    }

    jobs.set(newJob.id, newJob);

    // new idempotency record
    idempotencyRecords.set(operationKey,{
        fingerprint,
        jobId : newJob.id
    })

    return {
        jobId : newJob.id,
        workId : work.id,
        workStatus : work.status,
        idempotencyReplay : false
    }

}

/*
    CLIENT SIDE OPERATION
*/

type Operation = {
    content : string,
    idempotencyKey : string,
    inFlight? : Promise<unknown>
}

let currentOperation : Operation | undefined;

const createOperation = (
    content : string
) : Operation => {
    return {
        content,
        idempotencyKey : crypto.randomUUID(),
    }
}

// If an HTTP request is already processing return that request
const sendOperation = (
    operation : Operation
): Promise<unknown> => {
    // Double click : return running request
    if(operation.inFlight){
        return operation.inFlight;
    }

    operation.inFlight = axios.post("/jobs",{
        content : operation.content
    },{
        headers : {
            "idempotencyKey": operation.idempotencyKey
        }
    }).finally(()=>{
        operation.inFlight = undefined
    })

    return operation.inFlight
}

const submit = (content : string) : Promise<unknown> => {
    if(!currentOperation){
        currentOperation = createOperation(content);
    } 
    return sendOperation(currentOperation);
}

const retry = (): Promise<unknown> => {
    if(!currentOperation){
        throw new Error("No operation currently running")
    }

    return sendOperation(currentOperation);
}

const submitAgain = (
    content : string
): Promise<unknown> => {
    currentOperation = createOperation(content);
    return sendOperation(currentOperation);
}