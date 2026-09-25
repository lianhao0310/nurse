Pod::Spec.new do |s|
  s.name = 'LocalLLM'
  s.version = '0.1.0'
  s.summary = 'On-device LLM inference via llama.cpp'
  s.homepage = 'https://github.com/nurse/capacitor-local-llm'
  s.license = { :type => 'MIT' }
  s.author = { 'Nurse' => 'nurse@example.com' }
  s.source = { :path => '.' }
  s.source_files = 'Plugin/**/*.{swift,h,m,c,cpp}'
  s.public_header_files = 'Plugin/**/*.h'
  s.ios.deployment_target = '13.0'
  s.swift_version = '5.0'
  s.vendored_libraries = 'Plugin/llama/libllama.a', 'Plugin/llama/libggml.a', 'Plugin/llama/libggml-base.a', 'Plugin/llama/libcommon.a'
  s.xcconfig = {
    'HEADER_SEARCH_PATHS' => '"$(PODS_TARGET_SRCROOT)/Plugin/llama/include" "$(PODS_TARGET_SRCROOT)/Plugin"',
    'OTHER_LDFLAGS' => '-lc++ -framework Foundation -framework Metal -framework MetalKit'
  }
  s.pod_target_xcconfig = {
    'HEADER_SEARCH_PATHS' => '"$(PODS_TARGET_SRCROOT)/Plugin/llama/include" "$(PODS_TARGET_SRCROOT)/Plugin"'
  }
end
