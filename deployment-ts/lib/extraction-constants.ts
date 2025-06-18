export const COGNITO_NAME_PREFIX = 'video-analysis-user-pool';
export const STEP_FUNCTION_STATE_MACHINE_NAME_PREFIX = 'video-analysis-extraction-flow';
export const API_NAME_PREFIX = 'video-analysis-extraction-service';

export const VIDEO_EXTRACTION_CONCURRENT_LIMIT = '1';
export const VIDEO_IMAGE_EXTRACTION_CONCURRENT_LIMIT = '10';
export const VIDEO_IMAGE_EXTRACTION_SAMPLE_CONCURRENT_LIMIT = '2';
export const VIDEO_EXTRACTION_WORKFLOW_TIMEOUT_HR = '5';
export const VIDEO_SAMPLE_CHUNK_DURATION_S = '600';

export const S3_BUCKET_EXTRACTION_PREFIX = 'video-analysis-extr';
export const S3_PRE_SIGNED_URL_EXPIRY_S = '3600';
export const TRANSCRIBE_JOB_PREFIX = 'video_analysis_';
export const TRANSCRIBE_OUTPUT_PREFIX = 'transcribe';
export const VIDEO_SAMPLE_FILE_PREFIX = 'video_frame_';
export const VIDEO_SAMPLE_S3_PREFIX = 'video_frame_';
export const VIDEO_UPLOAD_S3_PREFIX = 'upload';
export const LAMBDA_LAYER_SOURCE_S3_KEY_OPENSEARCHPY = 'layer/opensearchpy_layer.zip';
export const LAMBDA_LAYER_SOURCE_S3_KEY_MOVIEPY = 'layer/moviepy_layer.zip';
export const LAMBDA_LAYER_SOURCE_S3_KEY_LANGCHAIN = 'layer/langchain_layer.zip';

export const SECRET_MANAGER_PREFIX = 'prod/shoppable/';
export const SECRET_MANAGER_OPENSEARCH_LOGIN_KEY = 'opensearchlogin';
export const OPENSERACH_USER_NAME = 'extr_srv_admin';
export const OPENSEARCH_DOMAIN_NAME_PREFIX = 'video-analysis';
export const OPENSEARCH_PORT = '443';
export const OPENSEARCH_INDEX_PREFIX_VIDEO_FRAME = 'video_frame_';
export const OPENSEARCH_VIDEO_FRAME_INDEX_MAPPING = '{"settings":{"index.knn":true,"number_of_shards":2},"mappings":{"properties":{"mm_embedding":{"type":"knn_vector","dimension":1024,"method":{"name":"hnsw","space_type":"l2","engine":"faiss"}},"text_embedding":{"type":"knn_vector","dimension":1024,"method":{"name":"hnsw","space_type":"l2","engine":"faiss"}},"timestamp":{"type":"double"},"task_id":{"type":"text","fields":{"keyword":{"type":"keyword","ignore_above":256}}}}}}';
export const OPENSEARCH_DEFAULT_K = '20';
export const OPENSEARCH_INDEX_NAME_VIDEO_FRAME_SIMILAIRTY_TEMP_PREFIX = 'video_frame_similiarity_check_temp_';
export const OPENSEARCH_INDEX_NAME_VIDEO_FRAME_SIMILAIRTY_THRESHOLD = '1.7';
export const OPENSEARCH_VIDEO_FRAME_SIMILAIRTY_INDEX_MAPPING = '{"mappings":{"properties":{"mm_embedding":{"type":"knn_vector","dimension":1024,"method":{"name":"hnsw","engine":"lucene","space_type":"l2","parameters":{}}}}}}';
export const OPENSEARCH_SHARD_SIZE_LIMIT = '104857600';

export const DYNAMO_VIDEO_TASK_TABLE = 'extr_srv_video_task';
export const DYNAMO_VIDEO_TRANS_TABLE = 'extr_srv_video_transcription';
export const DYNAMO_VIDEO_FRAME_TABLE = 'extr_srv_video_frame';
export const DYNAMO_VIDEO_ANALYSIS_TABLE = 'extr_srv_video_analysis';

export const REK_MIN_CONF_DETECT_CELEBRITY = '90';
export const REK_MIN_CONF_DETECT_LABEL = '80';
export const REK_MIN_CONF_DETECT_MODERATION = '70';
export const REK_MIN_CONF_DETECT_TEXT = '60';

export const BEDROCK_DEFAULT_MODEL_ID = 'anthropic.claude-v2:1';
export const BEDROCK_TITAN_MULTIMODEL_EMBEDDING_MODEL_ID = 'amazon.titan-embed-image-v1';
export const BEDROCK_TITAN_TEXT_EMBEDDING_MODEL_ID = 'amazon.titan-embed-text-v2:0';
export const BEDROCK_ANTHROPIC_CLAUDE_HAIKU = 'anthropic.claude-3-haiku-20240307-v1:0';
export const BEDROCK_ANTHROPIC_CLAUDE_HAIKU_MODEL_VERSION = 'bedrock-2023-05-31';
export const BEDROCK_ANTHROPIC_CLAUDE_SONNET_V35 = 'anthropic.claude-3-sonnet-20240229-v1:0';
export const PROMPTS_PLACE_HOLDER_CELEBRITY = 'CELEBRITY';
export const PROMPTS_PLACE_HOLDER_IMAGE_CAPTION = 'IMAGE_CAPTION';
export const PROMPTS_PLACE_HOLDER_KB_POLICY = 'KB_POLICY';
export const PROMPTS_PLACE_HOLDER_LABELS = 'LABEL';
export const VIDEO_FRAME_SIMILAIRTY_THRESHOLD_FAISS = '0.8';
