import { NextResponse } from 'next/server';

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { searchParams } = new URL(request.url);
    const version = searchParams.get('version');
    
    // Add your RunPod API call here to fetch the image
    const runpodResponse = await fetch(
      `${process.env.RUNPOD_API_URL}/workflow/${params.id}/output?version=${version}`,
      {
        headers: {
          'Authorization': `Bearer ${process.env.RUNPOD_API_KEY}`
        }
      }
    );

    if (!runpodResponse.ok) {
      throw new Error('Failed to fetch from RunPod');
    }

    const data = await runpodResponse.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch workflow output' },
      { status: 500 }
    );
  }
}