const axios = require("axios");

async function fetchMetrics() {
  const url =
    "https://api-orion-dev.perfroute.com/api/v1/pulse/trigger_manual_pulse";
  const headers = {
    "Content-Type": "application/json",
    Authorization:
      "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhenAiOiJodHRwczovL2RldmVsb3BtZW50LnBlcmZyb3V0ZS5jb20iLCJleHAiOjIwMzk2MDIzNDYsImlhdCI6MTcyNDA2OTU0NiwiaXNzIjoiaHR0cHM6Ly9uZWVkZWQtYW50ZWxvcGUtMjQuY2xlcmsuYWNjb3VudHMuZGV2IiwianRpIjoiZDMwMTZlZjMxMzY4YWZlMjVmM2EiLCJtZXRhZGF0YSI6e30sIm5iZiI6MTcyNDA2OTQ5Niwib3JnX2lkIjoib3JnXzJrc1BoZmRSblJTQVY3VkFlN2dpRmtvR0I3VSIsIm9yZ19wZXJtaXNzaW9ucyI6W10sIm9yZ19yb2xlIjoib3JnOmFkbWluIiwib3JnX3NsdWciOiJtYXVybyIsInNpZCI6InNlc3NfMmtzUGdkQmszck1LcjB3VmNwQVVUbEVYdlZsIiwic3ViIjoidXNlcl8ya3NQZ2Zzd2VzaEQ0a0EyNFdIeWxlZk5VRlEifQ._T88HLDK9v9aN5EqQHqyfX1OipGkqvLGz6txAo8MPYU",
  };

  const data = {
    name: "pulse without web test",
    pulse_status: "active",
    run_type: "manual",
    locations: ["oc_weu1_workers"],
    tags: ["mainnet", "tag1", "{{ method }}"],
    variables: [
      { name: "method", value: "GET" },
      { name: "base_url", value: "https://dummy-api.perfroute.com/status" },
    ],
    test_config: [
      {
        name: "test1",
        pulse_type: "http",
        continue_on_step_failure: true,
        ssl_prove: true,
        dns_prove: true,
        mtr_prove: false,
        tags: ["tag1", "tag2"],
        url: "{{base_url}}",
        http_request_options: {
          method: "{{ method }}",
          http_version: "HTTP2FallbackToHTTP1",
          follow_redirects: true,
          timeout_seconds: 15,
          headers: [
            { name: "Content-Type", value: "application/json" },
            { name: "Accept", value: "application/json" },
          ],
          cookies: [{ name: "session_id", value: "12345" }],
        },
        query_parameters: {
          parameters: [
            { name: "param1", value: "value1" },
            { name: "param2", value: "value2" },
          ],
        },
        request_body: {
          body_type: "application/json",
          body: '{"method":"getmininginfo","params":[],"id":9056,"jsonrpc":"2.0"}',
        },
        privacy: {
          do_not_save_response_body: false,
        },
        evaluation_function:
          "ZnVuY3Rpb24gbWFpbihwYXJhbXMpIHsKICAgIGNvbnN0IG1ldHJpYyA9IHBhcmFtcz8ubWV0cmljcz8uWzBdIHx8IHt9OwogICAgY29uc3QgeyBzc2xfbWV0cmljcywgc3RhdHVzX2NvZGUsIGRuc19sb29rdXBfdGltZSB9ID0gbWV0cmljOwoKICAgIGNvbnN0IGlzU3NsVmFsaWQgPSBzc2xfbWV0cmljcz8uZGF5c191bnRpbF9leHBpcnkgPCAxMDsKICAgIGNvbnN0IGlzU3RhdHVzT2sgPSBOdW1iZXIoc3RhdHVzX2NvZGUpID09PSAyMDA7CiAgICBjb25zdCBpc0Ruc0Zhc3QgPSBkbnNfbG9va3VwX3RpbWUgPCAxOwogICAgY29uc3QgZG5zRGF0YSA9IGRuc19sb29rdXBfdGltZTsKCiAgICBwZkFkZFZhcmlhYmxlKCJuYW1lIiwgImFsaSIpOwoKICAgIGNvbnN0IHN1Y2Nlc3MgPSBpc1NzbFZhbGlkICYmIGlzU3RhdHVzT2sgJiYgaXNEbnNGYXN0OwoKICAgIHJldHVybiB7CiAgICAgICAgc3VjY2Vzczogc3VjY2VzcywKICAgICAgICBuYW1lOiBuYW1lCiAgICB9Owp9Cg==",
      },
      // {
      //   name: "test2",
      //   pulse_type: "http",
      //   continue_on_step_failure: true,
      //   ssl_prove: true,
      //   dns_prove: true,
      //   mtr_prove: false,
      //   tags: ["tag1", "tag2"],
      //   url: "{{base_url}}",
      //   http_request_options: {
      //     method: "{{ method }}",
      //     http_version: "HTTP2FallbackToHTTP1",
      //     follow_redirects: true,
      //     timeout_seconds: 15,
      //     headers: [
      //       { name: "Content-Type", value: "application/json" },
      //       { name: "Accept", value: "application/json" },
      //     ],
      //     cookies: [{ name: "session_id", value: "12345" }],
      //   },
      //   query_parameters: {
      //     parameters: [
      //       { name: "param1", value: "value1" },
      //       { name: "param2", value: "value2" },
      //     ],
      //   },
      //   request_body: {
      //     body_type: "application/json",
      //     body: '{"method":"getmininginfo","params":[],"id":9056,"jsonrpc":"2.0"}',
      //   },
      //   privacy: {
      //     do_not_save_response_body: false,
      //   },
      //   evaluation_function:
      //     "ZnVuY3Rpb24gbWFpbihwYXJhbXMpIHsKICByZXR1cm4gewogICAgc3VjY2VzczogdHJ1ZSwKICAgIHNhYmVuZG9zOiB0aGlzLm1hdXJvLAogICAgZnJvbV90ZXN0MTogdGhpcy52YXJpYWJsZTEsCiAgfTsKfQo=",
      // },
    ],
    alert_config: {
      failed_total_locations: 1,
      failed_threshold_count: 3,
      success_total_locations: 1,
      success_threshold_count: 3,
    },
    renotification: false,
    renotification_seconds: 30,
    renotification_stop_after: 3,
    notification_priority: "critical",
    notification_title: "well something went off",
    notification_body: "well something went off",
    notifications: [
      { emails: ["mauro@perfroute.com"] },
      { integration_channel_id: "5b6fbf3d-6053-4209-8d89-ffc0368061b3" },
    ],
    max_retry: 3,
    schedule_interval_seconds: 10,
  };

  try {
    const response = await axios.post(url, data, { headers });
    return response.data;
  } catch (error) {
    console.error("Error fetching metrics:", error);
    return null;
  }
}

module.exports = fetchMetrics;
