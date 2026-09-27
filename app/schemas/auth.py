from pydantic import BaseModel, EmailStr, Field, model_validator

from app.core.passwords import password_problem


class UserRegister(BaseModel):
    full_name: str = Field(min_length=2, max_length=150)
    email: EmailStr
    phone: str | None = None
    password: str = Field(max_length=128)
    bar_council_id: str | None = None

    @model_validator(mode="after")
    def _strong_password(self) -> "UserRegister":
        if problem := password_problem(self.password, self.email):
            raise ValueError(problem)
        return self


class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


class VerifyEmailRequest(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6)


class ResendOtpRequest(BaseModel):
    email: EmailStr


class GoogleLoginRequest(BaseModel):
    id_token: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6)
    new_password: str = Field(max_length=128)

    @model_validator(mode="after")
    def _strong_password(self) -> "ResetPasswordRequest":
        if problem := password_problem(self.new_password, self.email):
            raise ValueError(problem)
        return self
