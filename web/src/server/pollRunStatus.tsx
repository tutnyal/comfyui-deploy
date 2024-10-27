// pollRunStatus.ts
import { db } from "@/db/db";
import { workflowRunsTable, workflowRunOutputs } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { MachineType } from "@/db/schema";

export const pollRunStatus = async (run_id: string, machine: MachineType, attempt = 1) => {
  const maxAttempts = 10;
  const delay = Math.min(5000 * 2 ** attempt, 60000); // Exponential backoff up to 60 seconds

  try {
    const response = await fetch(`${machine.endpoint}/status/${run_id}`, {
      method: "POST", // Adjusted to POST if required by API
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${machine.auth_token}`,
      },
      body: JSON.stringify({ run_id }), // Include if required by API
    });

    if (!response.ok) {
      throw new Error(`Error fetching run status: ${response.status} ${response.statusText}`);
    }

    const statusData = await response.json();
    console.log("Run Status Data:", statusData);

    if (statusData.status === "COMPLETED") {
      // Fetch images
      const imagesResponse = await fetch(`${machine.endpoint}/results/${run_id}`, {
        method: "GET", // Ensure this is the correct method
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${machine.auth_token}`,
        },
      });

      if (!imagesResponse.ok) {
        throw new Error(`Error fetching images: ${imagesResponse.status} ${imagesResponse.statusText}`);
      }

      const imagesData = await imagesResponse.json();
      console.log("Images Data:", imagesData);

      if (imagesData.images && imagesData.images.length > 0) {
        // Save images to the database using workflowRunOutputs
        await db.insert(workflowRunOutputs).values(
          imagesData.images.map((imageUrl: string) => ({
            run_id: run_id,
            data: { image_url: imageUrl },
          }))
        );
      } else {
        console.warn("No images found in the Runpod response.");
      }

      // Update run status in the database
      await db
        .update(workflowRunsTable)
        .set({ status: "success" })
        .where(eq(workflowRunsTable.id, run_id));

      console.log(`Workflow Run ${run_id} completed and images saved.`);
    } else if (statusData.status === "FAILED") {
      // Handle failure
      await db
        .update(workflowRunsTable)
        .set({ status: "failed" })
        .where(eq(workflowRunsTable.id, run_id));

      console.error(`Workflow Run ${run_id} failed.`);
    } else {
      // If still in progress, poll again after some time
      if (attempt < maxAttempts) {
        console.log(`Workflow Run ${run_id} still in progress. Polling again in ${delay / 1000} seconds.`);
        setTimeout(() => pollRunStatus(run_id, machine, attempt + 1), delay);
      } else {
        // Update run status to timed out
        await db
          .update(workflowRunsTable)
          .set({ status: "failed" })
          .where(eq(workflowRunsTable.id, run_id));
        console.error(`Workflow Run ${run_id} timed out after ${attempt} attempts.`);
      }
    }
  } catch (error) {
    console.error("Error in pollRunStatus:", error);
    // Optionally update the run status to failed
    await db
      .update(workflowRunsTable)
      .set({ status: "failed" })
      .where(eq(workflowRunsTable.id, run_id));
  }
};
