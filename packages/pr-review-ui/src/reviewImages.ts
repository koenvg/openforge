export interface ReviewImage {
  src: string
  alt: string
  filename: string
  label: string
  openLink?: () => void
}

export interface ReviewImageOpenRequest {
  images: ReviewImage[]
  activeIndex: number
}

export type OpenReviewImage = (request: ReviewImageOpenRequest) => void
