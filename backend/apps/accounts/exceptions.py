from rest_framework.views import exception_handler


class InsufficientCredits(Exception):
    def __init__(self, needed, balance):
        self.needed = needed
        self.balance = balance
        super().__init__(f"Needs {needed} credits, balance is {balance}")


def api_exception_handler(exc, context):
    if isinstance(exc, InsufficientCredits):
        from rest_framework.response import Response

        return Response(
            {"error": "insufficient_credits", "detail": str(exc), "needed": exc.needed, "balance": exc.balance},
            status=402,
        )
    response = exception_handler(exc, context)
    if response is not None and isinstance(response.data, dict) and "detail" in response.data:
        response.data = {"error": getattr(exc, "default_code", "error"), "detail": str(response.data["detail"])}
    return response
