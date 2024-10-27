import React from 'react';
import { OutputRender } from "./OutputRender";
import { CodeBlock } from "@/components/CodeBlock";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getRunsOutput } from "@/server/getRunsOutput";

interface RunOutput {
  id: string;
  data: {
    status: string;
    message: string;  // This will contain the base64 string
    images?: Array<{
      filename: string;
      metadata?: {
        width: number;
        height: number;
      };
    }>;
    files?: Array<{
      filename: string;
    }>;
    gifs?: Array<{
      filename: string;
    }>;
  };
}

const Base64Image = ({ base64String }: { base64String: string }) => {
  // Check if the string already includes the data URI prefix
  const imgSrc = base64String.startsWith('data:image') 
    ? base64String 
    : `data:image/png;base64,${base64String}`;

  return (
    <img 
      src={imgSrc} 
      alt="Generated output"
      className="max-w-full h-auto"
    />
  );
};

export async function RunOutputs({ run_id }: { run_id: string }) {
  const outputs = await getRunsOutput(run_id);

  if (!outputs || outputs.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground text-center">
        No outputs available for this run
      </div>
    );
  }

  return (
    <Table className="table-fixed">
      <TableHeader className="bg-background top-0 sticky">
        <TableRow>
          <TableHead className="w-[200px]">File</TableHead>
          <TableHead className="">Output</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {outputs.map((run: RunOutput) => {
          console.log("run.data:", run.data);

          // Handle base64 image case
          if (run.data.status === 'success' && run.data.message) {
            return (
              <TableRow key={run.id}>
                <TableCell>Generated Image</TableCell>
                <TableCell>
                  <Base64Image base64String={run.data.message} />
                </TableCell>
              </TableRow>
            );
          }

          // Original file handling logic
          const fileName =
            run.data.images?.[0]?.filename ||
            run.data.files?.[0]?.filename ||
            run.data.gifs?.[0]?.filename;

          if (!fileName) {
            return (
              <TableRow key={run.id}>
                <TableCell>Output</TableCell>
                <TableCell className="">
                  <CodeBlock
                    code={JSON.stringify(run.data, null, 2)}
                    lang="json"
                  />
                </TableCell>
              </TableRow>
            );
          }

          return (
            <TableRow key={run.id}>
              <TableCell className="break-words">
                <div className="flex flex-col gap-1">
                  <span>{fileName}</span>
                  {run.data.images?.[0]?.metadata && (
                    <span className="text-xs text-muted-foreground">
                      {run.data.images[0].metadata.width}x
                      {run.data.images[0].metadata.height}
                    </span>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <OutputRender run_id={run_id} filename={fileName} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}