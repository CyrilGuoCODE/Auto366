import { S3Client } from '@aws-sdk/client-s3'

/**
 * S3 client configuration for file storage
 * Uses environment variables for configuration
 */
export const createS3Client = () => {
  try {
    const endpoint = import.meta.env.S3_ENDPOINT
    const accessKeyId = import.meta.env.S3_ACCESS_KEY
    const secretAccessKey = import.meta.env.S3_SECRET_KEY
    const region = import.meta.env.S3_REGION || 'auto'

    if (!endpoint || !accessKeyId || !secretAccessKey) {
      console.warn('S3 configuration is incomplete. S3 features will be disabled.')
      return null
    }

    return new S3Client({
      endpoint,
      region,
      credentials: {
        accessKeyId,
        secretAccessKey
      },
      forcePathStyle: true // Required for S3-compatible services
    })
  } catch (error) {
    console.warn('Failed to create S3 client:', error.message)
    return null
  }
}

// Lazy initialization of S3 client
let _s3Client = null
export const getS3Client = () => {
  if (_s3Client === null) {
    _s3Client = createS3Client()
  }
  return _s3Client
}

// S3 bucket configuration
export const S3_CONFIG = {
  bucket: import.meta.env.S3_BUCKET || 'auto366-rulesets',
  paths: {
    json: 'json/',
    zip: 'zip/',
    temp: 'temp/'
  }
}