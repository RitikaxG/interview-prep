import { z } from "zod";

// 1. Create input schema
const ClaimUploadSchema = z.object({
    userId : z.uuid({
        error : "userId must be a valid uuid"
    }),
    documentId : z.uuid({
        error : "documentId must be a valid uuid"
    }),
    fileHash : z.string({
        error : "fileHash must be of type string"
    }).min(32,{
        error : "fileHash must be of minimum 32 characters"
    }),
    claimType : z.enum([
        "own_damage",
        "theft",
        "personal_accident",
        "third_party"
    ],{
        error : "claimType must be of supported claim type"
    }),
    metadata : z.record(z.string(),z.json()).optional()
});

// 2. Create DTO from schema
type ClaimUploadDTO = z.infer<typeof ClaimUploadSchema>;

// 3. Create validate input function
const validateClaimUpload = (
    body : unknown
) => {
    const result = ClaimUploadSchema.safeParse(body);
    

    if(!result.success){
        const flattened = z.flattenError(result.error);
        return {
            ok : false as const,
            status : 400 as const,
            fieldErrors : flattened.fieldErrors,
            formErrors : flattened.formErrors
        }
    }
    return {
        ok : true as const,
        dto : result.data
    }
}

// 4. Handle claim upload
const handleClaimUpload = (
    requestBody : unknown
) => {
    const validation = validateClaimUpload(requestBody);
    if(!validation.ok){
        return {
            status : validation.status,
            body : {
                message : "Claim upload data is invalid"
            },
            fieldErrors : validation.fieldErrors,
            formErrors : validation.formErrors
        }
    }

    const claim: ClaimUploadDTO = validation.dto;
    return {
        status : validation.status,
        body : {
            message : "Claim upload input is valid"
        },
        claim
    }
}
const invalidInput = {
    userId : "random_123 not uuid",
    documentId : "doc_123 not uuid",
    fileHash : "short",
    claimType : "medical",
    metadata : {
        source : 123
    }
}

console.dir(await handleClaimUpload(invalidInput),{ depth : 100 });

const validInput = {
    userId : "11111111-1111-4111-8111-111111111111",
    documentId :  "22222222-2222-4222-8222-222222222222",
    fileHash : "b".repeat(64),
    claimType : "theft",
    metadata : {
        source : "email"
    }
}

console.log(await handleClaimUpload(validInput));
