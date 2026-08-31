export interface ReviewMediaBase {
  src: string
  alt: string
  filename: string
  label: string
  openLink?: () => void
}

export interface ReviewImageMedia extends ReviewMediaBase {
  kind: 'image'
}

export interface ReviewVideoMedia extends ReviewMediaBase {
  kind: 'video'
}

export type ReviewMedia = ReviewImageMedia | ReviewVideoMedia

export interface ReviewMediaOpenRequest {
  items: ReviewMedia[]
  activeIndex: number
}

export interface ReviewImageOpenRequest {
  items: ReviewImageMedia[]
  activeIndex: number
}

export type OpenReviewMedia = (request: ReviewMediaOpenRequest) => void
