# AUREN FASHION — Team Contribution Report

## Project Overview

This project was developed as a one-week, two-person trial project for an Instagram-based clothing shop. The goal was to deliver a working, mobile-first ordering system with customer ordering and admin order management.

## Team Responsibilities

### Person 1 — Ebulfez

* Designed and implemented the main database structure.
* Worked on order and product data management.
* Resolved database-related issues and missing functionality.
* Worked on backend/data-related requirements of the project.
* Helped ensure that order data and application functionality worked correctly.
* Reviewed and verified changes through the project's Git/PR workflow.

### Person 2 — Hüseyn

* Worked primarily on the frontend and user-facing interface.
* Improved and completed missing parts of the admin panel.
* Worked on the live deployment and made the application available through a public URL.
* Improved the phone-first user experience and admin interface.
* Tested the deployed application and verified the main customer and admin flows.

## Team Workflow

The team used GitHub for version control. Changes were made locally, committed with meaningful messages, and submitted through pull requests. The other team member reviewed the changes before merging.

Both team members worked on understanding and reviewing each other's code so that the project could be explained during the final walkthrough.

## Implemented Features

* Guest customer ordering without an account.
* Product selection, size and quantity handling.
* Customer name, phone and address collection.
* Admin authentication.
* Newest-first order management.
* Customer name and phone search.
* Order status management.
* Cancellation handling.
* Product management.
* AZN/USD pricing with configurable exchange rate.
* Excel order export.
* Customer email notification system.
* Responsive, phone-first interface.
* Public deployment.

## Testing

The main customer and admin flows were tested locally and on the deployed application, including creating orders, managing orders, changing statuses, searching orders, managing products and exporting orders.

Email notifications were verified successfully in the local environment. The deployed Render environment currently has a Gmail SMTP connection timeout limitation.

## Deployment

The application was deployed as a public Render web service.

**Live URL:**
https://auren-fash-on-trial.onrender.com

## Final Note

The project was completed within the trial scope and timebox. Nice-to-have features such as customer accounts, past orders and one-click reorder were not implemented because they were outside the core required functionality.
