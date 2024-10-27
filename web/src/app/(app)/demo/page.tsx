// app/workflow/[id]/page.tsx
import WorkflowResultDisplay from '@/components/WorkflowImageDisplay';

interface PageProps {
  params: {
    id: string;
  };
}

export default function WorkflowPage({ params }: PageProps) {
  return (
    <div className="container mx-auto py-8">
      <WorkflowResultDisplay run_id={params.id} />
    </div>
  );
}