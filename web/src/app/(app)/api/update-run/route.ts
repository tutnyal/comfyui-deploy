import { parseDataSafe } from "../../../../lib/parseDataSafe";
import { db } from "@/db/db";
import { workflowRunOutputs, workflowRunsTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

const Request = z.object({
  run_id: z.string(),
  status: z
    .enum(["not-started", "running", "uploading", "success", "failed"])
    .optional(),
  output_data: z.any().optional(),
});

export async function POST(request: Request) {
  console.log("⭐ Update-run endpoint hit");
  const [data, error] = await parseDataSafe(Request, request);
  console.log("⭐ Parsed data:", data);
  if (!data || error) return error;

  const { run_id, status, output_data } = data;

  console.log(run_id, status, output_data);

  if (output_data) {
    try {
      const workflow_run_output = await db.insert(workflowRunOutputs)
        .values({
          run_id: run_id,
          data: output_data,
        })
        .returning();
      console.log('Insert successful:', workflow_run_output);
      
      const check = await db.query.workflowRunOutputs.findFirst({
        where: eq(workflowRunOutputs.run_id, run_id)
      });
      console.log('Saved output:', check);
    } catch (error) {
      console.error('Insert failed:', error);
    }
  } if (status) {
    // console.log("status", status);
    const workflow_run = await db
      .update(workflowRunsTable)
      .set({
        status: status,
        ended_at:
          status === "success" || status === "failed" ? new Date() : null,
      })
      .where(eq(workflowRunsTable.id, run_id))
      .returning();
  }

  // const workflow_version = await db.query.workflowVersionTable.findFirst({
  //   where: eq(workflowRunsTable.id, workflow_run[0].workflow_version_id),
  // });

  // revalidatePath(`./${workflow_version?.workflow_id}`);

  return NextResponse.json(
    {
      message: "success",
    },
    {
      status: 200,
    }
  );
}
