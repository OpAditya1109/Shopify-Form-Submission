import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});


/* -----------------------------
 FIND CUSTOMER BY EMAIL
----------------------------- */

async function findCustomerByEmail(email, SHOP, TOKEN) {

  const query = `
  {
    customers(first: 1, query: "email:${email}") {
      edges {
        node {
          id
          email
        }
      }
    }
  }
  `;

  const response = await fetch(
    `https://${SHOP}/admin/api/2024-01/graphql.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": TOKEN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query })
    }
  );

  const data = await response.json();

  return data?.data?.customers?.edges[0]?.node || null;
}


/* -----------------------------
 CREATE CUSTOMER
----------------------------- */

async function createCustomer(name, email, phone, marketplace, reward, SHOP, TOKEN) {

  const [first, ...rest] = name.split(" ");
  const last = rest.join(" ");

  const tags = [
    marketplace === "amazon" ? "amazon-customer" : "myntra-customer",
    reward === "cashback" ? "reward-cashback" : "reward-voucher",
    "review-submitted"
  ];

  if (reward === "cashback") {
    tags.push("upi-cashback");
  }

  const mutation = `
  mutation customerCreate($input: CustomerInput!) {
    customerCreate(input: $input) {
      customer { id }
      userErrors { field message }
    }
  }
  `;

  const variables = {
    input: {
      firstName: first,
      lastName: last,
      email,
      phone,
      tags
    }
  };

  const response = await fetch(
    `https://${SHOP}/admin/api/2024-01/graphql.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": TOKEN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query: mutation, variables })
    }
  );

  const data = await response.json();

  return data?.data?.customerCreate?.customer?.id;
}


/* -----------------------------
 UPDATE MARKETPLACE METAFIELDS
----------------------------- */

async function updateMarketplaceMetafield(customerId, marketplace, SHOP, TOKEN) {

  let metafields = [];

  if (marketplace === "amazon") {
    metafields.push({
      ownerId: customerId,
      namespace: "custom",
      key: "amazon_customer",
      type: "boolean",
      value: "true"
    });
  }

  if (marketplace === "myntra") {
    metafields.push({
      ownerId: customerId,
      namespace: "custom",
      key: "myntra_customer",
      type: "boolean",
      value: "true"
    });
  }

  const mutation = `
  mutation metafieldsSet($metafields:[MetafieldsSetInput!]!) {
    metafieldsSet(metafields:$metafields) {
      metafields { key namespace value }
      userErrors { field message }
    }
  }
  `;

  await fetch(
    `https://${SHOP}/admin/api/2024-01/graphql.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": TOKEN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        query: mutation,
        variables: { metafields }
      })
    }
  );
}


/* -----------------------------
 MAIN HANDLER
----------------------------- */

export default async function handler(req, res) {

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {

    const body = typeof req.body === "string"
      ? JSON.parse(req.body)
      : req.body;

    const {
      name,
      email,
      phone,
      order_id,
      marketplace,
      reward,
      screenshot,
      upi
    } = body;

    const SHOP = process.env.SHOPIFY_STORE;
    const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;

    let screenshotUrl = "";

    /* -----------------------------
     Upload screenshot to Cloudinary
    ----------------------------- */

    if (screenshot) {

      const upload = await cloudinary.uploader.upload(screenshot, {
        folder: "wellbi-reviews"
      });

      screenshotUrl = upload.secure_url;

    }


    /* -----------------------------
     CUSTOMER LOGIC
    ----------------------------- */

    const existingCustomer = await findCustomerByEmail(email, SHOP, TOKEN);

    let customerId;

    if (existingCustomer) {

      console.log("Existing customer found");

      customerId = existingCustomer.id;

    } else {

      console.log("Creating new customer");

      customerId = await createCustomer(
        name,
        email,
        phone,
        marketplace,
        reward,
        SHOP,
        TOKEN
      );

    }


    /* -----------------------------
     UPDATE MARKETPLACE METAFIELD
    ----------------------------- */

    await updateMarketplaceMetafield(
      customerId,
      marketplace,
      SHOP,
      TOKEN
    );


    /* -----------------------------
     CREATE METAOBJECT RECORD
    ----------------------------- */

    const createdAt = new Date().toISOString();

    const query = `
      mutation metaobjectCreate($metaobject: MetaobjectCreateInput!) {
        metaobjectCreate(metaobject: $metaobject) {
          metaobject { id }
          userErrors { field message }
        }
      }
    `;

    const variables = {
      metaobject: {
        type: "amazon_verification",
        fields: [
          { key: "name", value: name },
          { key: "email", value: email },
          { key: "phone", value: phone },
          { key: "order_id", value: order_id },
          { key: "marketplace", value: marketplace },
          { key: "reward", value: reward },
          { key: "upi", value: upi || "" },
          { key: "screenshot", value: screenshotUrl },
          { key: "status", value: "pending" },
          { key: "created_at", value: createdAt }
        ]
      }
    };

    const response = await fetch(
      `https://${SHOP}/admin/api/2024-01/graphql.json`,
      {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": TOKEN,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ query, variables })
      }
    );

    const data = await response.json();

    return res.status(200).json({
      success: true,
      data
    });

  } catch (error) {

    return res.status(500).json({
      error: error.message
    });

  }

}