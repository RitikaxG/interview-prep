import { prisma } from "./db";
import { type ClaimType, ClaimStatus } from "./generated/prisma/enums";
import { Job, Queue } from "bullmq";
import crypto from "node:crypto";

type User = {
    id : string;
    role : "reviewer" | "admin"
}

type RequestContext = {
    traceId : string;
    userId : string;
    startedAt : number;
}

type ClaimUploadRequest = {
    fileHash : string;
    claimType : "motor" | "health";
}

type ClaimUploadResult = {
    documentId : string;
    runId : string;
    status : string;
}

type ExtractionJobPayload = {
    traceId : string;
    userId : string;
    documentId : string;
    runId : string;
}

type EnqueueExtractionResult = {
    queued : boolean;
    queueName : string;
    jobName : string;
    jobId : string;
    runId : string;
    documentId : string;
}

type HandlerRequest = {
    user? : User,
    body : unknown
}

type HandlerResponse = {
    statusCode : number,
    body : {
        ok : boolean,
        queued? : boolean,
        queueName?: string,
        jobName? : string;
        jobId? : string;
        runId? : string;
        documentId? : string;
        traceId? : string;
        error? : string;
    }
}

class ValidationError extends Error {
    constructor(message : string){
        super(message);
        this.name = "ValidationError"
    }
};

class AuthError extends Error {
    constructor(message : string){
        super(message);
        this.name = "AuthError"
    }
};

class QueueError extends Error {
    constructor(message : string){
        super(message);
        this.name = "QueueError"
    }
};

const extractionQueue = new Queue<ExtractionJobPayload>("claim-extraction",{
    connection : {
        host : "localhost",
        port : 6379,
    }
});

const logEvent = (
    ctx : RequestContext,
    eventName : string,
    fields : Record<string,unknown> = {}
) => {
    console.log(JSON.stringify({
        traceId : ctx.traceId,
        userId : ctx.userId,
        eventName,
        ...fields
    }));
}

// validate()

const validateClaimUpload = async (
    ctx : RequestContext,
    body : unknown
) : Promise<ClaimUploadRequest> => {
    logEvent(ctx,"claim.validate.started");

    if(typeof body !== "object" || body === null){
        throw new ValidationError("body must be of type object");
    }

    const input = body as Partial<ClaimUploadRequest>;
    if(!input.fileHash || typeof input.fileHash !== "string"){
        throw new ValidationError("fileHash required");
    }

    if(input.fileHash.length < 8){
        throw new ValidationError("fileHash is too short");
    }

    if(input.claimType !== "motor" && input.claimType !== "health"){
        throw new ValidationError("claimType must be motor or health");
    }

    logEvent(ctx,"claim.validate.completed",{
        fileHash : input.fileHash,
        claimType : input.claimType
    });

    return {
        fileHash : input.fileHash,
        claimType : input.claimType
    }
}

// authorize()

const authorizeClaimUpload = async (
    ctx : RequestContext,
    user : User | undefined
): Promise<User> => {
    logEvent(ctx,"claim.authorize.started");

    if(!user){
        throw new AuthError("Unauthorized");
    }

    if(user.id !== ctx.userId){
        throw new AuthError("User request context mismatch");
    }

    if(user.role !== "reviewer" && user.role !== "admin"){
        throw new AuthError("User can't upload claims");
    }

    logEvent(ctx,"claim.authorize.completed",{
        role : user.role
    });

    return user;
}

// create()

const createClaimDocumentAndRun = async (
    ctx : RequestContext,
    input : ClaimUploadRequest
) : Promise<ClaimUploadResult> => {
    logEvent(ctx,"claim.create.started",{
        claimType : input.claimType
    });

    const result = await prisma.$transaction(async (tx) => {
        const document = await tx.claimDocument.create({
            data : {
                fileHash : input.fileHash,
                claimType : input.claimType as ClaimType,
                uploadedById : ctx.userId
            }
        });

        const run = await tx.claimRun.create({
            data : {
                documentId : document.id,
                status : ClaimStatus.UPLOADED_AND_RUN_CREATED,
                createdById : ctx.userId,
                traceId : ctx.traceId
            }
        });

        return {
            runId : run.id,
            documentId : document.id,
            status : run.status
        }
    });
    logEvent(ctx,"create.claim.completed",{
        runId : result.runId,
        documentId : result.documentId,
        status : result.status
    })

    return result;
}

// enqueue()

const enqueueExtraction = async (
    ctx : RequestContext,
    claim : ClaimUploadResult
): Promise<EnqueueExtractionResult> => {
    const queueName = "claim-extraction";
    const jobName = "extract-claim";

    const payload : ExtractionJobPayload = {
        traceId : ctx.traceId,
        userId : ctx.userId,
        runId : claim.runId,
        documentId : claim.documentId
    }

    logEvent(ctx,"claim.enqueue.started",{
        queueName,
        jobName,
        runId : claim.runId,
        documentId : claim.documentId
    });

    let job : Job<ExtractionJobPayload>;

    try{
        job = await extractionQueue.add(
            jobName,
            payload,
            {
                jobId : claim.runId, // one run will have one enqueued job
                attempts : 3,
                backoff : {
                    type : "exponential",
                    delay : 1000
                },
                removeOnComplete : true,
                removeOnFail : false
            }
        );
    }
    catch(error){
        const err = error instanceof Error ? error : new Error("Unknown error");

        logEvent(ctx,"claim.enqueue.failed",{
            queueName,
            jobName,
            runId : claim.runId,
            errorName : err.name,
            errorMessage : err.message
        })

        await prisma.claimRun.update({
            where : {
                id : claim.runId
            },
            data : {
                status : ClaimStatus.FAILED_TO_QUEUE
            }
        })
        throw new QueueError(`Failed to queue extraction job ${err.message}`);
    } 

    if(!job.id){
        await prisma.claimRun.update({
            where : {
                id : claim.runId
            },
            data : {
                status : ClaimStatus.FAILED_TO_QUEUE
            }
        })

        throw new QueueError("Added to queue but jobId not returned");
    }

    try {
        await prisma.claimRun.update({
        where: {
            id: claim.runId,
        },
        data: {
            status: ClaimStatus.QUEUED,
        },
        });
    } catch (error) {
        const err = error instanceof Error ? error : new Error("Unknown DB error");

        logEvent(ctx, "claim.queue_status_update.failed", {
            runId: claim.runId,
            jobId: job.id,
            errorName: err.name,
            errorMessage: err.message,
        });

        throw err;
    }

    logEvent(ctx, "claim.enqueue.completed", {
        queueName,
        jobName,
        jobId: job.id,
        runId: claim.runId,
    });

    return {
        queued: true,
        queueName,
        jobName,
        jobId: String(job.id),
        runId: claim.runId,
        documentId: claim.documentId,
    };
}

const postClaimHandler = async (
    req : HandlerRequest
): Promise<HandlerResponse> => {
    const ctx : RequestContext = {
        traceId : crypto.randomUUID(),
        userId : req.user?.id ?? "anonymous",
        startedAt : Date.now()
    };

    logEvent(ctx,"claim.request.started");

    try{
        const input = await validateClaimUpload(ctx,req.body);
        await authorizeClaimUpload(ctx,req.user);

        const claim = await createClaimDocumentAndRun(ctx, input);
        const enqueueClaim = await enqueueExtraction(ctx,claim);

        logEvent(ctx,"claim.request.completed",{
            queueName : enqueueClaim.queueName,
            jobName : enqueueClaim.jobName,
            jobId : enqueueClaim.jobId,
            runId : claim.runId,
            durationMs : Date.now() - ctx.startedAt
        });

        return {
            statusCode : 202,
            body : {
                ok : true,
                queued : enqueueClaim.queued,
                queueName : enqueueClaim.queueName,
                jobName : enqueueClaim.jobName,
                jobId : enqueueClaim.jobId,
                runId : enqueueClaim.runId,
                traceId : ctx.traceId,
                documentId : enqueueClaim.documentId
            }
        }
    }catch(error){
        const err = error instanceof Error ? error : new Error("Unknown error");

        logEvent(ctx,"claim.request.failed",{
            errorName : err.name,
            errorMessage : err.message,
            durationMs : Date.now() - ctx.startedAt
        });

        if(err instanceof ValidationError){
            return {
                statusCode : 400,
                body : {
                    ok : false,
                    traceId : ctx.traceId,
                    error : err.message
                }
            }
        }

        if(err instanceof AuthError){
            return {
                statusCode : req.user ? 403 : 401,
                body : {
                    ok : false,
                    traceId : ctx.traceId,
                    error : err.message
                }
            }
        }

        if(err instanceof QueueError){
            return {
                statusCode : 503,
                body : {
                    ok : false,
                    traceId : ctx.traceId,
                    error : "Claim was saved but extraction could not be queued. Retry"
                }
            }
        }

        return {
            statusCode : 500,
            body : {
                ok : false,
                traceId : ctx.traceId,
                error : "Unknown error"
            }
        }
    }
}