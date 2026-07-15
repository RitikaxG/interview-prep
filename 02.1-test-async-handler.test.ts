import { vi, it, expect } from "vitest";
import { prisma } from "./db";
import { beforeEach, describe } from "node:test";
import { ClaimStatus } from "./generated/prisma/enums";
import { postClaimHandler } from "./02-validate-authorize-save-enqueue";
// Mock DB 

vi.mock("./db", () => {
    return {
        prisma : {
            $transaction : vi.fn(),
            claimRun : {
                update : vi.fn()
            }
        }
    }
});

// Mock BullMQ
const mockQueueAdd = vi.hoisted(() => vi.fn());
vi.mock("bullmq", () => {
  return {
    Queue: vi.fn(function () {
      return {
        add: mockQueueAdd,
      };
    }),
    Job: class {},
  };
});

describe("postClaimHandler", () => {
    beforeEach(()=>{
        vi.clearAllMocks()
    });

    it("returns 202 when claim is validated, authorized , saved , queued and status updated", async () => {
        /*
        - Mock DB transaction
        - tx.claimDocument.create()
        - tx.claimRun.create()
        */

        vi.mocked(prisma.$transaction).mockImplementation(async (callbacks : any)=>{
            const tx = {
                claimDocument : {
                    create : vi.fn().mockResolvedValue({
                        id : "doc_123",
                        fileHash : "hash_123",
                        claimType : "motor"
                    })
                },
                claimRun : {
                    create : vi.fn().mockResolvedValue({
                        id : "run_123",
                        documentId : "doc_123",
                        status : ClaimStatus.UPLOADED_AND_RUN_CREATED
                    })
                }
            }
            return callbacks(tx)
        })

        /*
        Mock BullMQ queue.add()
        */
       mockQueueAdd.mockResolvedValue({
        id : "run_123",
        name : "extract_claim"
       });

       /*
       Mock run status update to QUEUED
       */
      vi.mocked(prisma.claimRun.update).mockResolvedValue({
        id : "run_123",
        status : ClaimStatus.QUEUED
      } as any);

      const response = await postClaimHandler({
        user : {
            id : "user_123",
            role : "reviewer"
        },
        body : {
            fileHash : "hash_123",
            claimType : "motor"
        }
      });

      expect(response.statusCode).toBe(202);
      expect(response.body.ok).toBe(true);
      expect(response.body.queued).toBe(true);
      expect(response.body.runId).toBe("run_123");
      expect(response.body.documentId).toBe("doc_123");
      expect(response.body.queueName).toBe("claim-extraction");
      expect(response.body.jobName).toBe("extract-claim");
      expect(response.body.jobId).toBe("run_123");
      expect(response.body.traceId).toBeDefined();

      expect(mockQueueAdd).toHaveBeenCalledTimes(1);
      
    })
})