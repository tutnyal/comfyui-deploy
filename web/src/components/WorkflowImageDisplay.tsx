"use client"
import React, { useState, useEffect } from 'react';
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertCircle } from 'lucide-react';

interface RunPodResponse {
  delayTime: number;
  executionTime: number;
  id: string;
  output: {
    message: string;
    status: string;
  };
  status: 'COMPLETED' | 'FAILED' | 'IN_PROGRESS' | 'IN_QUEUE';
  workerId: string;
}

interface WorkflowResultDisplayProps {
  run_id: string;
}

const WorkflowResultDisplay: React.FC<WorkflowResultDisplayProps> = ({ run_id }) => {
  const [result, setResult] = useState<RunPodResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const response = await fetch(`/api/check-status?run_id=${run_id}`);
        if (!response.ok) {
          throw new Error(response.status === 404 ? 'Run not found' : 'Failed to fetch status');
        }
        const data: RunPodResponse = await response.json();
        console.log('Fetched data:', data); // Debug log
        setResult(data);
        
        // Stop polling if we've reached a final state
        if (data.status === 'COMPLETED' || data.status === 'FAILED') {
          setLoading(false);
        }
      } catch (err) {
        console.error('Fetch error:', err); // Debug log
        setError(err instanceof Error ? err.message : 'An error occurred');
        setLoading(false);
      }
    };

    let intervalId: NodeJS.Timeout;
    
    if (run_id) {
      fetchStatus();
      // Poll every 3 seconds until we get a final status
      intervalId = setInterval(() => {
        if (!result || (result.status !== 'COMPLETED' && result.status !== 'FAILED')) {
          fetchStatus();
        }
      }, 3000);
    }

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [run_id, result?.status]);

  const renderContent = () => {
    if (loading && (!result || result.status !== 'COMPLETED')) {
      return (
        <div className="flex items-center justify-center p-8">
          <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
          <p className="ml-2">Processing your image... {result?.status || 'Initializing'}</p>
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex items-center gap-2 p-4 text-red-500">
          <AlertCircle className="h-4 w-4" />
          <p>{error}</p>
        </div>
      );
    }

    if (!result) {
      return (
        <div className="flex items-center gap-2 p-4 text-yellow-500">
          <AlertCircle className="h-4 w-4" />
          <p>No result data available</p>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {result.output?.message && (
          <div className="rounded-lg overflow-hidden border">
            <img 
              src={`data:image/jpeg;base64,${result.output.message}`}
              alt="Generated Result"
              className="w-full h-auto"
            />
          </div>
        )}
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
          <Badge variant="outline" className="justify-center">
            Status: {result.status}
          </Badge>
          <Badge variant="outline" className="justify-center">
            Output Status: {result.output?.status}
          </Badge>
          <Badge variant="outline" className="justify-center">
            Execution Time: {result.executionTime}ms
          </Badge>
          <Badge variant="outline" className="justify-center">
            Delay Time: {result.delayTime}ms
          </Badge>
          <Badge variant="outline" className="justify-center">
            Worker ID: {result.workerId}
          </Badge>
          <Badge variant="outline" className="justify-center">
            Run ID: {result.id}
          </Badge>
        </div>
      </div>
    );
  };

  return (
    <div className="w-full">
      <div className="max-h-[600px] overflow-y-auto p-4">
        {renderContent()}
      </div>
    </div>
  );
};

export default WorkflowResultDisplay;

// Complete RunPod response: {
//     delayTime: 655,
//     executionTime: 1655,
//     id: '443e6692-071a-405f-b0c2-c0fd32cb271e-u1',
//     output: {
//       message: 'image base64'
//     status: 'success'
//     },
//     status: 'COMPLETED',
//     workerId: '041ezl0qi31pes'
//   }