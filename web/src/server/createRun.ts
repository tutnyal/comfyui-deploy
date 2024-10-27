"use server";

import { db } from "@/db/db";
import type {
  MachineType,
  WorkflowRunOriginType,
  WorkflowVersionType,
} from "@/db/schema";
import { machinesTable, workflowRunsTable } from "@/db/schema";
import type { APIKeyUserType } from "@/server/APIKeyBodyRequest";
import { getRunsData } from "@/server/getRunsData";
import { ComfyAPI_Run } from "@/types/ComfyAPI_Run";
import { auth } from "@clerk/nextjs";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import "server-only";
import { v4 } from "uuid";
import { withServerPromise } from "./withServerPromise";
import { pollRunStatus } from "@/server/pollRunStatus"; // Adjust the path accordingly

export const createRun = withServerPromise(
  async ({
    origin,
    workflow_version_id,
    machine_id,
    inputs,
    runOrigin,
    apiUser,
  }: {
    origin: string;
    workflow_version_id: string | WorkflowVersionType;
    machine_id: string | MachineType;
    inputs?: Record<string, string | number>;
    runOrigin?: WorkflowRunOriginType;
    apiUser?: APIKeyUserType;
  }) => {
    const machine =
      typeof machine_id === "string"
        ? await db.query.machinesTable.findFirst({
            where: and(
              eq(machinesTable.id, machine_id),
              eq(machinesTable.disabled, false)
            ),
          })
        : machine_id;

    if (!machine) {
      throw new Error("Machine not found");
    }

    const workflow_version_data =
      typeof workflow_version_id === "string"
        ? await db.query.workflowVersionTable.findFirst({
            where: eq(workflowRunsTable.id, workflow_version_id),
            with: {
              workflow: {
                columns: {
                  org_id: true,
                  user_id: true,
                },
              },
            },
          })
        : workflow_version_id;

    if (!workflow_version_data) {
      throw new Error("Workflow version not found");
    }

    if (apiUser)
      if (apiUser.org_id) {
        // is org api call, check org only
        if (apiUser.org_id != workflow_version_data.workflow.org_id) {
          throw new Error("Workflow not found");
        }
      } else {
        // is user api call, check user only
        if (
          apiUser.user_id != workflow_version_data.workflow.user_id &&
          workflow_version_data.workflow.org_id == null
        ) {
          throw new Error("Workflow not found");
        }
      }

    const workflow_api = workflow_version_data.workflow_api;

    // Replace the inputs
    if (inputs && workflow_api) {
      for (const key in inputs) {
        Object.entries(workflow_api).forEach(([_, node]) => {
          if (node.inputs["input_id"] === key) {
            node.inputs["input_id"] = inputs[key];
            // Fix for external text default value
            if (node.class_type == "ComfyUIDeployExternalText") {
              node.inputs["default_value"] = inputs[key];
            }
          }
        });
      }
    }

    let prompt_id: string | undefined = undefined;
    const shareData = {
      workflow_api_raw: workflow_api,
      // workflow_api_raw: workflow_api,
      status_endpoint: `${origin}/api/update-run`,
      file_upload_endpoint: `${origin}/api/file-upload`,
      
    };
    // const shareData = {
    //   workflow_api_raw: workflow_api,
    //   status_endpoint: `https://6318-50-173-230-2.ngrok-free.app/api/update-run`,
    //   file_upload_endpoint: `https://6318-50-173-230-2.ngrok-free.app/api/file-upload`,
    // };
    
    // console.log("shareData:", shareData);

    prompt_id = v4();
    // console.log("workflow_api_raw_itut:", workflow_api);

    // Add to our db
    const workflow_run = await db
      .insert(workflowRunsTable)
      .values({
        id: prompt_id,
        workflow_id: workflow_version_data.workflow_id,
        workflow_version_id: workflow_version_data.id,
        workflow_inputs: inputs,
        machine_id: machine.id,
        origin: runOrigin,
      })
      .returning();
    console.log("Inserted Workflow Run:", workflow_run);
    revalidatePath(`/${workflow_version_data.workflow_id}`);

    try {
      switch (machine.type) {
        case "comfy-deploy-serverless":
        case "modal-serverless":
          const _data = {
            input: {
              ...shareData,
              prompt_id: prompt_id,
            },
          };

          const ___result = await fetch(`${machine.endpoint}/run`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(_data),
            cache: "no-store",
          });
          console.log(___result);
          if (!___result.ok)
            throw new Error(
              `Error creating run, ${
                ___result.statusText
              } ${await ___result.text()}`
            );
          console.log(_data, ___result);
          break;

        // case "runpod-serverless":
        //   const data = {
        //     input: {
        //       ...shareData,
        //       prompt_id: prompt_id,
        //     },
        //   };

        //   if (
        //     !machine.auth_token &&
        //     !machine.endpoint.includes("localhost") &&
        //     !machine.endpoint.includes("127.0.0.1")
        //   ) {
        //     throw new Error("Machine auth token not found");
        //   }

        //   const __result = await fetch(`${machine.endpoint}/run`, {
        //     method: "POST",
        //     headers: {
        //       "Content-Type": "application/json",
        //       Authorization: `Bearer ${machine.auth_token}`,
        //     },
        //     body: JSON.stringify(data),
        //     cache: "no-store",
        //   });
        //   console.log(__result);
        //   if (!__result.ok)
        //     throw new Error(
        //       `Error creating run, ${
        //         __result.statusText
        //       } ${await __result.text()}`
        //     );
        //   console.log(data, __result);
        //   break;
        
        // const ngrok ="https://6318-50-173-230-2.ngrok-free.app"
        case "runpod-serverless":
          const data = {
            input: {
              workflow: workflow_api, // Ensure 'workflow' key is correctly assigned
              // status_endpoint: `https://6318-50-173-230-2.ngrok-free.app/api/update-run`,
              // file_upload_endpoint: `https://6318-50-173-230-2.ngrok-free.app/api/file-upload`, 
              status_endpoint: `${origin}/api/update-run`,
              file_upload_endpoint: `${origin}/api/file-upload`,
              prompt_id: prompt_id,
            },
          };

          console.log("Payload sent to RunPod:", JSON.stringify(data, null, 2));

          if (
            !machine.auth_token &&
            !machine.endpoint.includes("localhost") &&
            !machine.endpoint.includes("127.0.0.1")
          ) {
            throw new Error("Machine auth token not found");
          }

          const __result = await fetch(`${machine.endpoint}/run`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${machine.auth_token}`,
            },
            body: JSON.stringify(data),
            cache: "no-store",
          });
          // console.log(__result);
          if (!__result.ok)
            throw new Error(
              `Error creating run, ${
                __result.statusText
              } ${await __result.text()}`,
            );
          // console.log("data, __result:", data, __result);
          // Parse the response body
          const resultData = await __result.json();
          console.log("Runpod Response Data:", resultData);

          // Check if images are included in the response
          if (resultData.images) {
            // Handle the images (e.g., save to database, return to client)
            console.log("Images received:", resultData.images);
          } else {
            console.warn("No images found in the response.");
          }
          break;


        case "classic":
          const body = {
            ...shareData,
            prompt_id: prompt_id,
          };
          // console.log(body);
          const comfyui_endpoint = `${machine.endpoint}/comfyui-deploy/run`;
          const _result = await fetch(comfyui_endpoint, {
            method: "POST",
            body: JSON.stringify(body),
            cache: "no-store",
          });
          // console.log(_result);

          if (!_result.ok) {
            let message = `Error creating run, ${_result.statusText}`;
            try {
              const result = await ComfyAPI_Run.parseAsync(
                await _result.json()
              );
              message += ` ${result.node_errors}`;
            } catch (error) {}
            throw new Error(message);
          }
          // prompt_id = result.prompt_id;
          break;
      }
    } catch (e) {
      console.error(e);
      await db
        .update(workflowRunsTable)
        .set({
          status: "failed",
        })
        .where(eq(workflowRunsTable.id, workflow_run[0].id));
      console.log(`Workflow Run ${workflow_run[0].id} marked as failed.`);
      throw e;
    }

    // It successfully started, update the started_at time
    await db
      .update(workflowRunsTable)
      .set({
        started_at: new Date(),
      })
      .where(eq(workflowRunsTable.id, workflow_run[0].id));
    console.log(`Workflow Run ${workflow_run[0].id} started at ${new Date()}.`);

    // Start polling for run status
    // pollRunStatus(workflow_run[0].id, machine);

    return {
      workflow_run_id: workflow_run[0].id,
      message: "Successful workflow run",
    };

  }
);

export async function checkStatus(run_id: string) {
  const { userId } = auth();
  if (!userId) throw new Error("User not found");

  return await getRunsData(run_id);
}
