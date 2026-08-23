interface InsertRequest {
  id: number
}

export class InsertRequestCoordinator<Request extends InsertRequest> {
  private lastHandledRequestId = 0

  takeNewReadyRequest(request: Request | null, isReady: boolean): Request | null {
    if (!isReady || !request || request.id === this.lastHandledRequestId) return null

    this.lastHandledRequestId = request.id
    return request
  }
}
