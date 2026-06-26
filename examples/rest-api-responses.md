# PART II: API Response Payload Reference

## Feature Experimentation API Response Payloads

### Flags Endpoints

#### GET `/projects/{project_id}/flags`
```json
{
  "count": 2,
  "items": [
    {
      "key": "feature_flag_1",
      "name": "Feature Flag 1",
      "description": "Enable new checkout flow",
      "enabled": true,
      "archived": false,
      "variable_definitions": [
        {
          "key": "button_color",
          "type": "string",
          "default_value": "blue"
        }
      ],
      "variations": [
        {
          "key": "variation_1",
          "name": "Control",
          "description": "Original version",
          "variables": {
            "button_color": "blue"
          }
        },
        {
          "key": "variation_2",
          "name": "Treatment",
          "description": "New version",
          "variables": {
            "button_color": "green"
          }
        }
      ],
      "environments": {
        "production": {
          "enabled": true,
          "rollout_percentage": 50
        },
        "development": {
          "enabled": true,
          "rollout_percentage": 100
        }
      },
      "created": "2024-01-15T10:30:00Z",
      "modified": "2024-01-20T14:45:00Z"
    }
  ],
  "next": "/projects/12345/flags?page=2",
  "previous": null
}
```

#### GET `/projects/{project_id}/flags/{flag_key}`
```json
{
  "key": "feature_flag_1",
  "name": "Feature Flag 1",
  "description": "Enable new checkout flow",
  "enabled": true,
  "archived": false,
  "variable_definitions": [
    {
      "key": "button_color",
      "type": "string",
      "default_value": "blue"
    },
    {
      "key": "discount_percentage",
      "type": "integer",
      "default_value": 10
    }
  ],
  "variations": [
    {
      "key": "control",
      "name": "Control",
      "description": "Original checkout",
      "variables": {
        "button_color": "blue",
        "discount_percentage": 10
      },
      "weight": 5000
    },
    {
      "key": "treatment",
      "name": "Treatment",
      "description": "New checkout flow",
      "variables": {
        "button_color": "green",
        "discount_percentage": 15
      },
      "weight": 5000
    }
  ],
  "environments": {
    "production": {
      "enabled": true,
      "rules": [
        {
          "key": "beta_users",
          "priority": 1,
          "conditions": {
            "audience_conditions": ["beta_testers"]
          },
          "percentage_included": 100,
          "variation_key": "treatment"
        }
      ],
      "traffic_allocation": {
        "control": 5000,
        "treatment": 5000
      }
    }
  },
  "created": "2024-01-15T10:30:00Z",
  "modified": "2024-01-20T14:45:00Z",
  "created_by": "user@example.com",
  "modified_by": "admin@example.com"
}
```

#### PATCH `/projects/{project_id}/flags`
```json
{
  "flags_updated": [
    {
      "key": "feature_flag_1",
      "status": "success"
    },
    {
      "key": "feature_flag_2",
      "status": "success"
    }
  ],
  "errors": []
}
```

#### POST `/projects/{project_id}/flags/archived`
```json
{
  "archived": ["feature_flag_1", "feature_flag_2"],
  "failed": [],
  "message": "Successfully archived 2 flags"
}
```

### Variations Endpoints (Feature Experimentation Only)

#### GET `/projects/{project_id}/flags/{flag_key}/variations`
```json
{
  "count": 3,
  "items": [
    {
      "key": "control",
      "name": "Control",
      "description": "Original experience",
      "variables": {
        "header_text": "Welcome",
        "button_color": "#0066CC"
      },
      "weight": 3333,
      "archived": false
    },
    {
      "key": "variation_a",
      "name": "Variation A",
      "description": "New header design",
      "variables": {
        "header_text": "Welcome! Start Here",
        "button_color": "#0066CC"
      },
      "weight": 3333,
      "archived": false
    },
    {
      "key": "variation_b",
      "name": "Variation B",
      "description": "New button color",
      "variables": {
        "header_text": "Welcome",
        "button_color": "#00AA00"
      },
      "weight": 3334,
      "archived": false
    }
  ]
}
```

### Rules and Rulesets Endpoints

#### GET `/projects/{project_id}/flags/{flag_key}/environments/{environment_key}/ruleset`
```json
{
  "flag_key": "feature_flag_1",
  "environment_key": "production",
  "enabled": true,
  "rules": [
    {
      "key": "vip_customers",
      "priority": 1,
      "enabled": true,
      "conditions": {
        "audience_conditions": [
          {
            "audience_id": "vip_audience",
            "conditions": {
              "and": [
                {
                  "type": "custom_attribute",
                  "name": "plan_type",
                  "match_type": "exact",
                  "value": "premium"
                }
              ]
            }
          }
        ]
      },
      "percentage_included": 100,
      "variation_key": "premium_experience"
    },
    {
      "key": "gradual_rollout",
      "priority": 2,
      "enabled": true,
      "conditions": {
        "audience_conditions": []
      },
      "percentage_included": 25,
      "deliver": "default"
    }
  ],
  "default_variation": "control",
  "traffic_allocation": {
    "control": 7500,
    "treatment": 2500
  }
}
```

#### GET `/projects/{project_id}/flags/{flag_key}/environments/{environment_key}/rules/{rule_key}`
```json
{
  "key": "vip_customers",
  "name": "VIP Customer Rule",
  "priority": 1,
  "enabled": true,
  "conditions": {
    "audience_conditions": [
      {
        "audience_id": "12345",
        "audience_name": "VIP Customers",
        "conditions": {
          "and": [
            {
              "type": "custom_attribute",
              "name": "lifetime_value",
              "match_type": "gt",
              "value": 1000
            },
            {
              "type": "custom_attribute", 
              "name": "account_status",
              "match_type": "exact",
              "value": "active"
            }
          ]
        }
      }
    ]
  },
  "percentage_included": 100,
  "variation_key": "vip_treatment",
  "created": "2024-01-10T09:00:00Z",
  "modified": "2024-01-15T11:30:00Z"
}
```

### Change History Endpoints

#### GET `/projects/{project_id}/flags/{flag_key}/history`
```json
{
  "count": 50,
  "items": [
    {
      "id": "hist_123456",
      "timestamp": "2024-01-20T14:45:00Z",
      "user": {
        "id": "user_456",
        "email": "admin@example.com",
        "name": "Admin User"
      },
      "action": "update",
      "changes": {
        "rules": {
          "before": {
            "gradual_rollout": {
              "percentage_included": 20
            }
          },
          "after": {
            "gradual_rollout": {
              "percentage_included": 25
            }
          }
        }
      },
      "environment": "production",
      "comment": "Increasing rollout to 25%"
    },
    {
      "id": "hist_123455",
      "timestamp": "2024-01-19T10:00:00Z",
      "user": {
        "id": "user_789",
        "email": "dev@example.com",
        "name": "Developer"
      },
      "action": "enable",
      "changes": {
        "enabled": {
          "before": false,
          "after": true
        }
      },
      "environment": "production",
      "comment": "Enabling flag for production launch"
    }
  ],
  "next": "/projects/12345/flags/feature_flag_1/history?page=2"
}
```

## Web Experimentation API Response Payloads

### Projects Endpoints

#### GET `/projects`
```json
{
  "projects": [
    {
      "id": 12345,
      "name": "E-commerce Website",
      "account_id": 98765,
      "status": "active",
      "created": "2023-06-15T10:00:00.000Z",
      "modified": "2024-01-20T15:30:00.000Z",
      "platform": "web",
      "environments": [
        {
          "id": 1,
          "key": "production",
          "name": "Production",
          "is_primary": true
        }
      ],
      "web_snippet": {
        "js_file_size": 234567,
        "code_revision": 456,
        "plugin_compatibility": true
      }
    }
  ],
  "meta": {
    "page": 1,
    "per_page": 25,
    "total": 3
  }
}
```

#### GET `/projects/{project_id}`
```json
{
  "id": 12345,
  "name": "E-commerce Website",
  "account_id": 98765,
  "status": "active",
  "created": "2023-06-15T10:00:00.000Z",
  "modified": "2024-01-20T15:30:00.000Z",
  "platform": "web",
  "sdks": ["javascript"],
  "environments": [
    {
      "id": 1,
      "key": "production",
      "name": "Production",
      "is_primary": true,
      "archived": false
    },
    {
      "id": 2,
      "key": "staging", 
      "name": "Staging",
      "is_primary": false,
      "archived": false
    }
  ],
  "web_snippet": {
    "enable_force_variation": false,
    "exclude_disabled_experiments": false,
    "exclude_names": true,
    "include_jquery": false,
    "ip_anonymization": true,
    "ip_filter": "^206\\.23\\.100\\.([5-9][0-9]|1([0-4][0-9]|50))$",
    "js_file_size": 234567,
    "library": "jquery-3.5.1",
    "plugin_compatibility": true,
    "code_revision": 456
  },
  "settings": {
    "anonymize_ip": true,
    "hide_snippet": false,
    "mask_descriptors": true,
    "trim_visitor_whitespace": true
  }
}
```

### Experiments Endpoints (Variations Included in Experiment Objects)

#### GET `/experiments`
```json
{
  "experiments": [
    {
      "id": 78901,
      "project_id": 12345,
      "name": "Homepage Hero Test",
      "key": "homepage_hero_test",
      "status": "running",
      "type": "a/b",
      "created": "2024-01-10T09:00:00.000Z",
      "modified": "2024-01-15T14:30:00.000Z",
      "campaign_id": 45678,
      "metrics": [
        {
          "event_id": 11111,
          "event_name": "purchase_completed",
          "is_primary": true,
          "scope": "visitor"
        }
      ],
      "variations": [
        {
          "variation_id": 22222,
          "name": "Control",
          "weight": 5000,
          "archived": false
        },
        {
          "variation_id": 33333,
          "name": "Hero Image B",
          "weight": 5000,
          "archived": false
        }
      ],
      "audience_conditions": "everyone",
      "traffic_allocation": 10000,
      "schedule": {
        "start_time": "2024-01-10T09:00:00.000Z",
        "stop_time": null
      }
    }
  ],
  "meta": {
    "page": 1,
    "per_page": 25,
    "total": 15
  }
}
```

#### GET `/experiments/{experiment_id}` (Full Experiment with Variations)
```json
{
  "id": 78901,
  "project_id": 12345,
  "name": "Homepage Hero Test",
  "key": "homepage_hero_test",
  "description": "Testing new hero image on homepage",
  "status": "running",
  "type": "a/b",
  "created": "2024-01-10T09:00:00.000Z",
  "modified": "2024-01-15T14:30:00.000Z",
  "campaign_id": 45678,
  "holdback": 0,
  "metrics": [
    {
      "event_id": 11111,
      "event_name": "purchase_completed",
      "event_type": "custom",
      "aggregator": "unique",
      "scope": "visitor",
      "is_primary": true,
      "display_title": "Purchase Conversion Rate"
    },
    {
      "event_id": 22222,
      "event_name": "add_to_cart",
      "event_type": "custom",
      "aggregator": "unique",
      "scope": "visitor",
      "is_primary": false,
      "display_title": "Add to Cart Rate"
    }
  ],
  "variations": [
    {
      "variation_id": 33333,
      "name": "Control",
      "description": "Original hero image",
      "weight": 5000,
      "archived": false,
      "actions": [
        {
          "page_id": 44444,
          "changes": [
            {
              "type": "custom_code",
              "value": "/* Control - no changes */"
            }
          ]
        }
      ]
    },
    {
      "variation_id": 55555,
      "name": "Hero Image B",
      "description": "New hero with lifestyle imagery",
      "weight": 5000,
      "archived": false,
      "actions": [
        {
          "page_id": 44444,
          "changes": [
            {
              "type": "attribute",
              "selector": ".hero-image",
              "attribute": "src",
              "value": "/images/hero-lifestyle-b.jpg"
            },
            {
              "type": "text",
              "selector": ".hero-title",
              "value": "Welcome to Our Store"
            }
          ]
        }
      ]
    }
  ],
  "audience_conditions": {
    "audience_ids": [66666],
    "conditions": ["and", {"audience_id": 66666}]
  },
  "traffic_allocation": 10000,
  "activation_mode": "immediate",
  "url_conditions": [
    {
      "edit_url": "https://example.com",
      "match_type": "simple",
      "value": "https://example.com"
    }
  ],
  "schedule": {
    "start_time": "2024-01-10T09:00:00.000Z",
    "stop_time": null
  }
}
```

#### POST `/experiments` (Request with Variations)
Request Body:
```json
{
  "project_id": 12345,
  "campaign_id": 45678,
  "name": "New Product Page Test",
  "key": "product_page_test",
  "type": "a/b",
  "status": "not_started",
  "metrics": [
    {
      "event_id": 11111,
      "is_primary": true
    }
  ],
  "variations": [
    {
      "name": "Control",
      "weight": 5000,
      "actions": [
        {
          "page_id": 44444,
          "changes": []
        }
      ]
    },
    {
      "name": "New Layout",
      "weight": 5000,
      "actions": [
        {
          "page_id": 44444,
          "changes": [
            {
              "type": "custom_css",
              "value": ".product-layout { display: grid; }"
            }
          ]
        }
      ]
    }
  ],
  "audience_conditions": "everyone",
  "traffic_allocation": 10000
}
```

#### GET `/experiments/{experiment_id}/results`
```json
{
  "experiment_id": 78901,
  "stats_config": {
    "confidence_level": 0.95,
    "use_stats_engine": true,
    "stats_engine_version": "sequential"
  },
  "results": [
    {
      "variation_id": 33333,
      "variation_name": "Control",
      "metrics": {
        "11111": {
          "name": "purchase_completed",
          "samples": 15420,
          "conversions": 462,
          "conversion_rate": 0.0299,
          "lift": {
            "value": 0,
            "confidence_interval": [null, null]
          },
          "statistical_significance": null,
          "is_baseline": true
        }
      },
      "visitors": 15420
    },
    {
      "variation_id": 55555,
      "variation_name": "Hero Image B",
      "metrics": {
        "11111": {
          "name": "purchase_completed",
          "samples": 15380,
          "conversions": 508,
          "conversion_rate": 0.0330,
          "lift": {
            "value": 0.103,
            "confidence_interval": [0.012, 0.194]
          },
          "statistical_significance": 0.97,
          "is_baseline": false,
          "improvement_status": "better"
        }
      },
      "visitors": 15380
    }
  ],
  "reach": {
    "baseline_count": 15420,
    "treatment_count": 15380,
    "total_count": 30800
  },
  "stats_summary": {
    "start_time": "2024-01-10T09:00:00.000Z",
    "last_update": "2024-01-20T16:45:00.000Z"
  }
}
```

### Campaigns Endpoints

#### GET `/campaigns`
```json
{
  "campaigns": [
    {
      "id": 45678,
      "project_id": 12345,
      "name": "Q1 Homepage Testing",
      "status": "running",
      "created": "2024-01-05T08:00:00.000Z",
      "modified": "2024-01-15T10:00:00.000Z",
      "experiments": [78901, 78902],
      "holdback": 0,
      "type": "a/b"
    }
  ],
  "meta": {
    "page": 1,
    "per_page": 25,
    "total": 5
  }
}
```

### Pages Endpoints

#### GET `/pages`
```json
{
  "pages": [
    {
      "id": 44444,
      "project_id": 12345,
      "name": "Homepage",
      "edit_url": "https://example.com",
      "category": "landing",
      "created": "2023-08-20T10:00:00.000Z",
      "modified": "2024-01-05T12:00:00.000Z",
      "page_type": "single_url",
      "conditions": [
        {
          "match_type": "simple",
          "value": "https://example.com"
        }
      ],
      "activation_type": "polling",
      "activation_code": "function() { return window.location.pathname === '/'; }",
      "archived": false
    },
    {
      "id": 55555,
      "project_id": 12345,
      "name": "Product Pages",
      "edit_url": "https://example.com/products/*",
      "category": "product",
      "created": "2023-09-15T11:00:00.000Z",
      "modified": "2023-12-20T14:00:00.000Z",
      "page_type": "substring",
      "conditions": [
        {
          "match_type": "substring",
          "value": "/products/"
        }
      ],
      "activation_type": "immediate",
      "archived": false
    }
  ],
  "meta": {
    "page": 1,
    "per_page": 25,
    "total": 8
  }
}
```

### Events Endpoints

#### GET `/events`
```json
{
  "events": [
    {
      "id": 11111,
      "project_id": 12345,
      "name": "Purchase Completed",
      "key": "purchase_completed",
      "category": "other",
      "event_type": "custom",
      "created": "2023-07-01T09:00:00.000Z",
      "modified": "2023-07-01T09:00:00.000Z",
      "is_classic": false,
      "archived": false
    },
    {
      "id": 22222,
      "project_id": 12345,
      "name": "Add to Cart",
      "key": "add_to_cart",
      "category": "add_to_cart",
      "event_type": "custom",
      "created": "2023-07-01T09:30:00.000Z",
      "modified": "2023-07-01T09:30:00.000Z",
      "is_classic": false,
      "archived": false
    },
    {
      "id": 33333,
      "project_id": 12345,
      "name": "Homepage View",
      "key": "homepage_view",
      "category": "page_activated",
      "event_type": "page_activated",
      "page_id": 44444,
      "created": "2023-08-20T10:00:00.000Z",
      "modified": "2023-08-20T10:00:00.000Z",
      "is_classic": false,
      "archived": false
    }
  ],
  "meta": {
    "page": 1,
    "per_page": 25,
    "total": 12,
    "include_classic": false
  }
}
```

### Audiences Endpoints

#### GET `/audiences`
```json
{
  "audiences": [
    {
      "id": 66666,
      "project_id": 12345,
      "name": "Mobile Visitors",
      "description": "Visitors using mobile devices",
      "created": "2023-09-01T10:00:00.000Z",
      "modified": "2023-09-01T10:00:00.000Z",
      "segmentation": true,
      "conditions": {
        "and": [
          {
            "type": "device",
            "value": "mobile"
          }
        ]
      },
      "archived": false
    },
    {
      "id": 77777,
      "project_id": 12345,
      "name": "Returning Customers",
      "description": "Customers who have made a purchase",
      "created": "2023-10-15T11:00:00.000Z",
      "modified": "2023-10-15T11:00:00.000Z",
      "segmentation": true,
      "conditions": {
        "and": [
          {
            "type": "custom_attribute",
            "name": "customer_type",
            "match_type": "exact",
            "value": "returning"
          }
        ]
      },
      "archived": false
    }
  ],
  "meta": {
    "page": 1,
    "per_page": 25,
    "total": 5
  }
}
```

### Attributes Endpoints

#### GET `/attributes`
```json
{
  "attributes": [
    {
      "id": 88888,
      "project_id": 12345,
      "key": "customer_type",
      "name": "Customer Type",
      "description": "Type of customer (new, returning, vip)",
      "created": "2023-07-15T09:00:00.000Z",
      "modified": "2023-07-15T09:00:00.000Z",
      "archived": false
    },
    {
      "id": 99999,
      "project_id": 12345,
      "key": "cart_value",
      "name": "Cart Value",
      "description": "Current cart value in cents",
      "created": "2023-07-20T10:00:00.000Z",
      "modified": "2023-07-20T10:00:00.000Z",
      "archived": false
    }
  ],
  "meta": {
    "page": 1,
    "per_page": 25,
    "total": 8
  }
}
```

### List Attributes Endpoints

#### GET `/list_attributes`
```json
{
  "list_attributes": [
    {
      "id": 12121,
      "project_id": 12345,
      "name": "VIP Email List",
      "key": "vip_emails",
      "description": "List of VIP customer emails",
      "list_type": "email",
      "key_field": "email",
      "created": "2023-11-01T10:00:00.000Z",
      "modified": "2024-01-10T15:00:00.000Z",
      "item_count": 1250,
      "archived": false
    },
    {
      "id": 13131,
      "project_id": 12345,
      "name": "Beta User IDs",
      "key": "beta_users",
      "description": "User IDs enrolled in beta program",
      "list_type": "custom",
      "key_field": "user_id",
      "created": "2023-12-05T11:00:00.000Z",
      "modified": "2024-01-15T09:00:00.000Z",
      "item_count": 500,
      "archived": false
    }
  ],
  "meta": {
    "page": 1,
    "per_page": 25,
    "total": 3
  }
}
```

#### POST `/list_attributes` (Response)
```json
{
  "id": 14141,
  "project_id": 12345,
  "name": "Premium Customers",
  "key": "premium_customers",
  "description": "List of premium tier customers",
  "list_type": "custom",
  "key_field": "customer_id",
  "created": "2024-01-20T16:00:00.000Z",
  "modified": "2024-01-20T16:00:00.000Z",
  "item_count": 0,
  "archived": false,
  "upload_url": "https://upload.optimizely.com/list_attributes/14141/upload?token=abc123",
  "upload_expires": "2024-01-20T17:00:00.000Z"
}
```

## Agent API Response Payloads

### Decision Endpoints

#### POST `/v1/decide`
```json
[
  {
    "flagKey": "checkout_flow",
    "ruleKey": "targeted_delivery",
    "enabled": true,
    "variationKey": "new_checkout",
    "reasons": [],
    "userContext": {
      "userId": "user123",
      "attributes": {
        "plan_type": "premium",
        "device_type": "mobile"
      }
    },
    "variables": {
      "button_color": "#00AA00",
      "header_text": "Fast Checkout",
      "enable_express": true
    }
  },
  {
    "flagKey": "recommendation_engine",
    "ruleKey": "default",
    "enabled": true,
    "variationKey": "ml_based",
    "reasons": [],
    "userContext": {
      "userId": "user123",
      "attributes": {
        "plan_type": "premium",
        "device_type": "mobile"
      }
    },
    "variables": {
      "algorithm": "collaborative_filtering",
      "max_recommendations": 8
    }
  }
]
```

#### POST `/v1/activate` (Feature Response)
```json
{
  "userId": "user123",
  "featureKey": "checkout_flow",
  "type": "feature",
  "experimentKey": "",
  "variationKey": "new_checkout",
  "enabled": true,
  "variables": {
    "button_color": "#00AA00",
    "header_text": "Fast Checkout",
    "enable_express": true
  },
  "error": ""
}
```

#### POST `/v1/activate` (Experiment Response)
```json
{
  "userId": "user123",
  "featureKey": "",
  "type": "experiment",
  "experimentKey": "homepage_test",
  "variationKey": "variation_b",
  "enabled": false,
  "variables": {},
  "error": ""
}
```

### Configuration Endpoints

#### GET `/v1/config`
```json
{
  "environment": {
    "sdk_key": "ABC123xyz",
    "environment": "production",
    "datafile_url": "https://cdn.optimizely.com/datafiles/ABC123xyz.json"
  },
  "agent": {
    "name": "optimizely-agent",
    "version": "2.4.0",
    "author": "Optimizely Inc.",
    "build_date": "2024-01-15"
  },
  "service": {
    "host": "0.0.0.0",
    "port": 8080,
    "api_version": "v1"
  },
  "runtime": {
    "go_version": "go1.19",
    "uptime_seconds": 345600,
    "start_time": "2024-01-15T10:00:00Z"
  }
}
```

#### GET `/v1/datafile`
```json
{
  "version": "4",
  "rollouts": [],
  "typedAudiences": [],
  "anonymizeIP": false,
  "projectId": "12345",
  "variables": [],
  "featureFlags": [
    {
      "experimentIds": ["78901"],
      "rolloutId": "",
      "variables": [
        {
          "defaultValue": "blue",
          "type": "string",
          "id": "1234",
          "key": "button_color"
        }
      ],
      "id": "5678",
      "key": "checkout_flow"
    }
  ],
  "experiments": [
    {
      "status": "Running",
      "id": "78901",
      "key": "checkout_test",
      "layerId": "9012",
      "trafficAllocation": [
        {
          "entityId": "3456",
          "endOfRange": 5000
        },
        {
          "entityId": "7890",
          "endOfRange": 10000
        }
      ],
      "audienceIds": [],
      "variations": [
        {
          "variables": [],
          "id": "3456",
          "key": "control",
          "featureEnabled": true
        },
        {
          "variables": [
            {
              "id": "1234",
              "value": "green"
            }
          ],
          "id": "7890",
          "key": "treatment",
          "featureEnabled": true
        }
      ]
    }
  ],
  "audiences": [],
  "groups": [],
  "attributes": [],
  "accountId": "98765",
  "events": [
    {
      "experimentIds": ["78901"],
      "id": "11111",
      "key": "purchase"
    }
  ],
  "revision": "456"
}
```

### Admin Endpoints

#### GET `/info`
```json
{
  "name": "optimizely-agent",
  "version": "2.4.0",
  "author": "Optimizely Inc.",
  "build_date": "2024-01-15T08:00:00Z",
  "commit": "abc123def456",
  "go_version": "go1.19",
  "uptime": "4 days, 0 hours, 0 minutes",
  "config": {
    "sdk_keys": ["ABC123xyz"],
    "environment": "production"
  }
}
```

#### GET `/health`
```json
{
  "status": "healthy",
  "version": "2.4.0"
}
```

#### GET `/metrics` (Prometheus format)
```
# HELP optimizely_agent_active_connections Number of active client connections
# TYPE optimizely_agent_active_connections gauge
optimizely_agent_active_connections 42

# HELP optimizely_agent_decide_requests_total Total number of decide requests
# TYPE optimizely_agent_decide_requests_total counter
optimizely_agent_decide_requests_total{sdk_key="ABC123xyz"} 125847

# HELP optimizely_agent_decide_duration_seconds Decide request duration
# TYPE optimizely_agent_decide_duration_seconds histogram
optimizely_agent_decide_duration_seconds_bucket{le="0.001"} 95234
optimizely_agent_decide_duration_seconds_bucket{le="0.005"} 120543
optimizely_agent_decide_duration_seconds_bucket{le="0.01"} 125000
optimizely_agent_decide_duration_seconds_sum 234.56
optimizely_agent_decide_duration_seconds_count 125847
```

## OAuth/Authentication Response Payloads

### POST `https://app.optimizely.com/oauth2/token`
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_in": 7200,
  "refresh_token": "def50200b5c2894...",
  "scope": "all"
}
```

## Error Response Payloads

### Standard Error Response
```json
{
  "error": "Resource not found",
  "uuid": "req-uuid-123456789",
  "code": "404_NOT_FOUND"
}
```

### Validation Error Response
```json
{
  "error": "Validation failed",
  "uuid": "req-uuid-987654321",
  "code": "400_VALIDATION_ERROR",
  "details": {
    "fields": {
      "name": ["Name is required"],
      "weight": ["Sum of variation weights must equal 10000"]
    }
  }
}
```

### Rate Limit Error Response
```json
{
  "error": "Rate limit exceeded",
  "uuid": "req-uuid-112233445",
  "code": "429_RATE_LIMITED",
  "retry_after": 60
}
```

### Authentication Error Response
```json
{
  "error": "Invalid or expired token",
  "uuid": "req-uuid-556677889",
  "code": "401_UNAUTHORIZED"
}
```

## Implementation Notes for AI Agents

1. **Response Parsing**
   - Always check for error responses before processing data
   - Handle both single objects and arrays appropriately
   - Account for optional fields that may be null or missing

2. **Variations Handling for Web Experimentation**
   - Variations are ALWAYS part of experiment objects
   - There are NO separate variation endpoints
   - To manage variations, update the entire experiment object

3. **Pagination Handling**
   - Look for `meta` objects in list responses
   - Use `next` URLs when provided for easier pagination
   - Track total count to know when all data is retrieved

4. **Data Types**
   - Weights are typically in basis points (5000 = 50%)
   - Timestamps are in ISO 8601 format
   - IDs can be strings or integers depending on the resource

5. **Null vs Missing Fields**
   - Null typically means explicitly unset
   - Missing fields use defaults or are not applicable
   - Empty arrays mean no items, not an error

6. **Response Headers**
   - Check X-RateLimit headers for current usage
   - Use ETag headers for caching when available
   - Monitor X-Request-ID for debugging

This comprehensive reference provides the complete and accurate response structure for every API endpoint, enabling AI agents to parse and utilize the data effectively with proper understanding of the differences between Web Experimentation and Feature Experimentation APIs.